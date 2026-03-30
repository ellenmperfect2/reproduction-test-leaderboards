#!/usr/bin/env python3
"""
One-off script to create a fresh plan + subscription for the leaderboard,
then immediately backfill 4 weeks of data so the dashboard has history.

Run with:
    ORB_API_KEY=xxx python3 scripts/setup_subscription.py

Prints the new subscription ID at the end — set that as ORB_SUBSCRIPTION_ID
in your Vercel environment variables, then redeploy.
"""

import os
import json
import hashlib
import random
import time
import requests
from datetime import datetime, timezone, timedelta

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

API_KEY = os.environ.get("ORB_API_KEY")
if not API_KEY:
    raise SystemExit("ORB_API_KEY environment variable is required")

ORB_BASE     = "https://api.withorb.com/v1"
SEED_SUB_ID  = "FGQW6GSocFiMatbF"
GROUPING_KEY = "user_name"
NUM_SEATS    = 7

USERS = [
    {"name": "Elena Marchetti",  "base_credits": 300_000},
    {"name": "James Okafor",     "base_credits": 240_000},
    {"name": "Priya Suresh",     "base_credits": 180_000},
    {"name": "Tom Bauer",        "base_credits": 130_000},
    {"name": "Anika Johansson",  "base_credits":  90_000},
    {"name": "Carlos Reyes",     "base_credits":  60_000},
    {"name": "Sophie Dubois",    "base_credits":  40_000},
]

AUTH = {"Authorization": f"Bearer {API_KEY}"}

# ── HTTP helpers ──────────────────────────────────────────────────────────────

def get(path: str) -> dict:
    res = requests.get(f"{ORB_BASE}{path}", headers=AUTH)
    if not res.ok:
        raise SystemExit(f"GET {path} failed ({res.status_code}): {res.text}")
    return res.json()

def post(path: str, body: dict, allow_error: bool = False) -> tuple[int, dict]:
    res = requests.post(
        f"{ORB_BASE}{path}",
        json=body,
        headers={**AUTH, "Content-Type": "application/json"},
    )
    if not allow_error and not res.ok:
        raise SystemExit(f"POST {path} failed ({res.status_code}): {res.text}")
    return res.status_code, res.json()

def sha256(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

# ── Date helpers ──────────────────────────────────────────────────────────────

def week_start(offset_weeks: int = 0) -> datetime:
    """Monday 00:00 UTC, offset_weeks ago."""
    now = datetime.now(timezone.utc)
    days_from_monday = (now.weekday())  # Monday = 0
    monday = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days_from_monday + offset_weeks * 7)
    return monday

def week_end(offset_weeks: int = 0) -> datetime:
    return week_start(offset_weeks) + timedelta(days=7)

def week_credits(base: int, offset_weeks: int) -> int:
    """Vary credits ±25% per week so rankings shift naturally."""
    seed = base * 100 + offset_weeks
    rng = random.Random(seed)
    return int(base * rng.uniform(0.75, 1.25))

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ts = int(datetime.now(timezone.utc).timestamp())
    now = datetime.now(timezone.utc)

    # ── 1. Customer ───────────────────────────────────────────────────────────
    print("Fetching customer...")
    sub = get(f"/subscriptions/{SEED_SUB_ID}")
    customer_id = sub["customer"]["id"]
    print(f"  customer_id: {customer_id}")

    # ── 2. Items ──────────────────────────────────────────────────────────────
    print("Creating items...")
    _, seat_item = post("/items", {"name": f"Seats {ts}"})
    item_id = seat_item["id"]
    print(f"  seat item_id: {item_id}")

    _, metric_item = post("/items", {"name": f"License API Calls {ts}"})
    metric_item_id = metric_item["id"]
    print(f"  metric item_id: {metric_item_id}")

    # ── 3. Billable metric ────────────────────────────────────────────────────
    print("Looking for billable metric...")
    metrics = get("/metrics?limit=100")
    existing_metric = next(
        (m for m in metrics.get("data", [])
         if m.get("name") == "License API Calls"),
        None,
    )
    if existing_metric:
        metric_id = existing_metric["id"]
        print(f"  Found: {metric_id}")
    else:
        print("  Creating metric...")
        _, metric = post("/metrics", {
            "name": "License API Calls",
            "description": "Sum of credits from license API call events",
            "item_id": metric_item_id,
            "sql": "SELECT SUM(credits) FROM events WHERE event_name = 'license_api_call'",
        })
        metric_id = metric["id"]
        print(f"  Created: {metric_id}")

    # ── 4. License type ───────────────────────────────────────────────────────
    print("Creating license type...")
    _, lt = post("/license_types", {"name": f"Seat {ts}", "grouping_key": GROUPING_KEY})
    license_type_id = lt["id"]
    print(f"  license_type_id: {license_type_id}")

    # ── 5. Plan ───────────────────────────────────────────────────────────────
    print("Creating plan...")
    _, plan = post("/plans", {
        "name": f"Leaderboard Plan {ts}", "currency": "USD", "net_terms": 0,
        "prices": [
            {
                "license_allocation_price": {
                    "name": "Seats", "item_id": item_id,
                    "cadence": "monthly", "model_type": "unit",
                    "unit_config": {"unit_amount": "350000"},
                    "fixed_price_quantity": NUM_SEATS,
                    "billed_in_advance": True,
                    "license_type_configuration": {
                        "license_type_id": license_type_id,
                        "license_grouping_key": GROUPING_KEY,
                    },
                    "license_allocations": [{"currency": "USD", "amount": "350000"}],
                }
            },
            {
                "price": {
                    "name": "API Calls", "item_id": metric_item_id,
                    "billable_metric_id": metric_id,
                    "cadence": "monthly", "model_type": "unit",
                    "unit_config": {"unit_amount": "1.00"},
                    "billed_in_advance": False,
                    "license_type_configuration": {
                        "license_type_id": license_type_id,
                        "license_grouping_key": GROUPING_KEY,
                    },
                }
            },
        ],
    })
    plan_id = plan["id"]
    print(f"  plan_id: {plan_id}")

    # ── 6. Subscription ───────────────────────────────────────────────────────
    print("Creating subscription...")
    start_date = (now - timedelta(days=28)).strftime("%Y-%m-%d")  # start 4 weeks ago
    _, subscription = post("/subscriptions", {
        "customer_id": customer_id,
        "plan_id": plan_id,
        "start_date": start_date,
    })
    subscription_id = subscription["id"]
    print(f"  subscription_id: {subscription_id}")

    # ── 7. Licenses ───────────────────────────────────────────────────────────
    print("Creating licenses...")
    for i, user in enumerate(USERS):
        if i > 0:
            time.sleep(1)
        status, _ = post("/licenses", {
            "subscription_id": subscription_id,
            "license_type_id": license_type_id,
            "external_license_id": user["name"],
        }, allow_error=True)
        print(f"  {user['name']}: {status}")

    # ── 8. Backfill 4 weeks of events ─────────────────────────────────────────
    # Weeks 3, 2, 1 ago → backfill API
    # Current week       → regular ingest (now - 30s)

    print("\nBackfilling 4 weeks of data...")

    for offset in [3, 2, 1]:
        w_start = week_start(offset)
        w_end   = week_end(offset)
        # Use Wednesday noon of that week as the event timestamp
        event_ts = (w_start + timedelta(days=2)).replace(hour=12).isoformat()

        print(f"  Week -{offset} ({w_start.strftime('%b %d')} – {(w_end - timedelta(days=1)).strftime('%b %d')})...")

        # Create backfill window
        _, bf = post("/events/backfills", {
            "timeframe_start": w_start.isoformat(),
            "timeframe_end":   w_end.isoformat(),
            "customer_id":     customer_id,
        })
        backfill_id = bf["id"]

        # Build events
        events = []
        for user in USERS:
            credits = week_credits(user["base_credits"], offset)
            base = {
                "event_name": "license_api_call",
                "properties": {GROUPING_KEY: user["name"], "credits": credits},
                "timestamp":  event_ts,
                "customer_id": customer_id,
            }
            events.append({**base, "idempotency_key": sha256(base)})

        # Ingest under backfill
        _, result = post(f"/ingest?backfill_id={backfill_id}&debug=true", {"events": events}, allow_error=True)
        ingested = len(result.get("debug", {}).get("ingested", []))
        failed   = len(result.get("validation_failed", []))
        print(f"    {ingested} ingested, {failed} failed")
        if failed:
            for f in result.get("validation_failed", []):
                print(f"    ✗ {f.get('validation_errors')}")

        # Close backfill
        post(f"/events/backfills/{backfill_id}/close", {})
        print(f"    Backfill closed.")

    # Current week — regular ingest
    event_ts = (now - timedelta(seconds=30)).isoformat()
    print(f"  Current week (now)...")
    events = []
    for user in USERS:
        credits = week_credits(user["base_credits"], 0)
        base = {
            "event_name": "license_api_call",
            "properties": {GROUPING_KEY: user["name"], "credits": credits},
            "timestamp":  event_ts,
            "customer_id": customer_id,
        }
        events.append({**base, "idempotency_key": sha256(base)})

    _, result = post("/ingest?debug=true", {"events": events}, allow_error=True)
    ingested = len(result.get("debug", {}).get("ingested", []))
    failed   = len(result.get("validation_failed", []))
    print(f"    {ingested} ingested, {failed} failed")

    # ── Done ──────────────────────────────────────────────────────────────────
    print()
    print("=" * 60)
    print("All done! Set this in Vercel → Environment Variables:")
    print()
    print(f"  ORB_SUBSCRIPTION_ID={subscription_id}")
    print()
    print("Then redeploy. The weekly_ingest.py script will keep it fresh.")
    print("=" * 60)

if __name__ == "__main__":
    main()
