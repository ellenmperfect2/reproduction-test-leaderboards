#!/usr/bin/env python3
"""
One-off script to create a fresh plan + subscription for the leaderboard.

Run with:
    ORB_API_KEY=xxx python3 scripts/setup_subscription.py

Prints the new subscription ID at the end — set that as ORB_SUBSCRIPTION_ID
in your Vercel environment variables.
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

API_KEY = os.environ.get("ORB_API_KEY")
if not API_KEY:
    raise SystemExit("ORB_API_KEY environment variable is required")

ORB_BASE     = "https://api.withorb.com/v1"
SEED_SUB_ID  = "FGQW6GSocFiMatbF"   # used only to look up the customer
GROUPING_KEY = "user_name"
NUM_SEATS    = 7

AUTH = {"Authorization": f"Bearer {API_KEY}"}

def get(path: str) -> dict:
    res = requests.get(f"{ORB_BASE}{path}", headers=AUTH)
    if not res.ok:
        raise SystemExit(f"GET {path} failed ({res.status_code}): {res.text}")
    return res.json()

def post(path: str, body: dict) -> dict:
    res = requests.post(
        f"{ORB_BASE}{path}",
        json=body,
        headers={**AUTH, "Content-Type": "application/json"},
    )
    if not res.ok:
        raise SystemExit(f"POST {path} failed ({res.status_code}): {res.text}")
    return res.json()

def main():
    ts = int(datetime.now(timezone.utc).timestamp())

    # ── 1. Get customer from seed subscription ────────────────────────────────
    print("Fetching customer...")
    sub = get(f"/subscriptions/{SEED_SUB_ID}")
    customer_id = sub["customer"]["id"]
    print(f"  customer_id: {customer_id}")

    # ── 2. Find or create the billable metric ─────────────────────────────────
    print("Looking for billable metric...")
    metrics = get("/metrics?limit=100")
    metric = next(
        (m for m in metrics.get("data", [])
         if m.get("name") == "License API Calls" or m.get("event_name") == "license_api_call"),
        None,
    )
    if metric:
        metric_id      = metric["id"]
        metric_item_id = metric["item"]["id"]
        print(f"  Found existing metric: {metric_id}")
    else:
        print("  Creating metric...")
        metric = post("/metrics", {
            "name":       "License API Calls",
            "event_name": "license_api_call",
            "item_name":  "License API Calls",
            "sql":        "SELECT SUM(credits) FROM events WHERE event_name = 'license_api_call'",
        })
        metric_id      = metric["id"]
        metric_item_id = metric["item"]["id"]
        print(f"  Created metric: {metric_id}")

    # ── 3. Create item for seat price ─────────────────────────────────────────
    print("Creating item...")
    item = post("/items", {"name": f"Seats {ts}"})
    item_id = item["id"]
    print(f"  item_id: {item_id}")

    # ── 4. Create license type ────────────────────────────────────────────────
    print("Creating license type...")
    lt = post("/license_types", {
        "name":         f"Seat {ts}",
        "grouping_key": GROUPING_KEY,
    })
    license_type_id = lt["id"]
    print(f"  license_type_id: {license_type_id}")

    # ── 5. Create plan ────────────────────────────────────────────────────────
    print("Creating plan...")
    plan = post("/plans", {
        "name":     f"Leaderboard Plan {ts}",
        "currency": "USD",
        "net_terms": 0,
        "prices": [
            {
                "license_allocation_price": {
                    "name":                 "Seats",
                    "item_id":              item_id,
                    "cadence":              "monthly",
                    "model_type":           "unit",
                    "unit_config":          {"unit_amount": "350000"},
                    "fixed_price_quantity": NUM_SEATS,
                    "billed_in_advance":    True,
                    "license_type_configuration": {
                        "license_type_id":     license_type_id,
                        "license_grouping_key": GROUPING_KEY,
                    },
                    "license_allocations": [{"currency": "USD", "amount": "350000"}],
                }
            },
            {
                "price": {
                    "name":               "API Calls",
                    "item_id":            metric_item_id,
                    "billable_metric_id": metric_id,
                    "cadence":            "monthly",
                    "model_type":         "unit",
                    "unit_config":        {"unit_amount": "1.00"},
                    "billed_in_advance":  False,
                    "license_type_configuration": {
                        "license_type_id":      license_type_id,
                        "license_grouping_key": GROUPING_KEY,
                    },
                }
            },
        ],
    })
    plan_id = plan["id"]
    print(f"  plan_id: {plan_id}")

    # ── 6. Create subscription ────────────────────────────────────────────────
    print("Creating subscription...")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    subscription = post("/subscriptions", {
        "customer_id": customer_id,
        "plan_id":     plan_id,
        "start_date":  today,
    })
    subscription_id = subscription["id"]
    print(f"  subscription_id: {subscription_id}")

    # ── Done ──────────────────────────────────────────────────────────────────
    print()
    print("=" * 60)
    print("Setup complete. Add this to Vercel environment variables:")
    print()
    print(f"  ORB_SUBSCRIPTION_ID={subscription_id}")
    print()
    print("Then redeploy, and run the weekly ingest script to populate data.")
    print("=" * 60)

if __name__ == "__main__":
    main()
