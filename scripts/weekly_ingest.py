#!/usr/bin/env python3
"""
Weekly Orb leaderboard data ingestion.

Ingests one event per user for the current week. Credits are seeded by
week number so rankings shift naturally each week.

Usage (one-off):
    ORB_API_KEY=xxx ORB_SUBSCRIPTION_ID=xxx python3 scripts/weekly_ingest.py

Or with a .env file:
    pip install python-dotenv requests
    python3 scripts/weekly_ingest.py

Cron (every Monday 9am):
    crontab -e
    0 9 * * 1 cd /Users/ellen/reproduction-test-leaderboards && ORB_API_KEY=xxx ORB_SUBSCRIPTION_ID=xxx python3 scripts/weekly_ingest.py >> /tmp/orb_ingest.log 2>&1
"""

import os
import json
import hashlib
import random
import requests
from datetime import datetime, timezone, timedelta

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv optional — env vars can be passed directly

ORB_BASE = "https://api.withorb.com/v1"

# ── Config ────────────────────────────────────────────────────────────────────

API_KEY = os.environ.get("ORB_API_KEY")
SUBSCRIPTION_ID = os.environ.get("ORB_SUBSCRIPTION_ID")

if not API_KEY:
    raise SystemExit("ORB_API_KEY environment variable is required")
if not SUBSCRIPTION_ID:
    raise SystemExit("ORB_SUBSCRIPTION_ID environment variable is required")

# Base credit amounts — varied each week by ±20% using the week number as seed
USERS = [
    {"name": "Elena Marchetti",  "base_credits": 300_000},
    {"name": "James Okafor",     "base_credits": 240_000},
    {"name": "Priya Suresh",     "base_credits": 180_000},
    {"name": "Tom Bauer",        "base_credits": 130_000},
    {"name": "Anika Johansson",  "base_credits":  90_000},
    {"name": "Carlos Reyes",     "base_credits":  60_000},
    {"name": "Sophie Dubois",    "base_credits":  40_000},
]

# ── Helpers ───────────────────────────────────────────────────────────────────

AUTH = {"Authorization": f"Bearer {API_KEY}"}

def orb_get(path: str) -> dict:
    res = requests.get(f"{ORB_BASE}{path}", headers=AUTH)
    res.raise_for_status()
    return res.json()

def orb_post(path: str, body: dict) -> tuple[int, dict]:
    res = requests.post(
        f"{ORB_BASE}{path}",
        json=body,
        headers={**AUTH, "Content-Type": "application/json"},
    )
    return res.status_code, res.json()

def sha256(payload: dict) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode()
    ).hexdigest()

def week_number() -> int:
    """ISO week number of the current week."""
    return datetime.now(timezone.utc).isocalendar()[1]

def credits_for_week(base: int, week: int) -> int:
    """Vary credits ±20% deterministically by week number so rankings shift."""
    rng = random.Random(week * 1000 + base)
    factor = rng.uniform(0.80, 1.20)
    return int(base * factor)

def find_license_type(plan_prices: list) -> tuple[str, str] | tuple[None, None]:
    """Extract (license_type_id, grouping_key) from plan prices."""
    for price in plan_prices:
        candidates = [price] + [v for v in price.values() if isinstance(v, dict)]
        for obj in candidates:
            cfg = obj.get("license_type_configuration")
            if cfg and cfg.get("license_type_id"):
                return cfg["license_type_id"], cfg.get("license_grouping_key", "user_email")
    return None, None

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    now = datetime.now(timezone.utc)
    week = week_number()
    print(f"[{now.strftime('%Y-%m-%d %H:%M')} UTC] Week {week} — ingesting {len(USERS)} users")

    # Fetch subscription → customer ID + license type
    sub = orb_get(f"/subscriptions/{SUBSCRIPTION_ID}")
    customer_id: str = sub["customer"]["id"]

    license_type_id, grouping_key = find_license_type(
        sub.get("plan", {}).get("prices", [])
    )
    if not license_type_id:
        raise SystemExit(
            "No license type found on subscription plan.\n"
            "Run 'Generate Example Data' in the dashboard first to set up the plan."
        )

    print(f"  customer:      {customer_id}")
    print(f"  license_type:  {license_type_id}  (key: {grouping_key})")

    # Create licenses — safe to retry, errors are logged and skipped
    print("  Creating licenses...")
    for user in USERS:
        status, resp = orb_post("/licenses", {
            "subscription_id": SUBSCRIPTION_ID,
            "license_type_id": license_type_id,
            "external_license_id": user["name"],
        })
        if status not in (200, 201):
            print(f"    {user['name']}: {status} (may already exist)")

    # Ingest events — timestamp is now-30s so it's safely in the past
    timestamp = (now - timedelta(seconds=30)).isoformat()
    events = []
    for user in USERS:
        credits = credits_for_week(user["base_credits"], week)
        base = {
            "event_name": "license_api_call",
            "properties": {grouping_key: user["name"], "credits": credits},
            "timestamp": timestamp,
            "customer_id": customer_id,
        }
        events.append({**base, "idempotency_key": sha256(base)})
        print(f"    {user['name']}: {credits:,} credits")

    status, resp = orb_post("/events/ingest?debug=true", {"events": events})
    ingested = len(resp.get("debug", {}).get("ingested", []))
    dupes    = len(resp.get("debug", {}).get("duplicate", []))
    failed   = len(resp.get("validation_failed", []))
    print(f"  Ingest result: {ingested} ingested, {dupes} duplicate, {failed} failed")
    if failed:
        for f in resp["validation_failed"]:
            print(f"    ✗ {f.get('idempotency_key', '')[:16]}… {f.get('validation_errors')}")

    print("Done.")

if __name__ == "__main__":
    main()
