import { NextResponse } from "next/server";
import { Orb } from "orb-billing";

export const maxDuration = 60;

const SUBSCRIPTION_ID = "FGQW6GSocFiMatbF";
const ORB_BASE = "https://api.withorb.com/v1";

function getWeekStart(offsetWeeks = 0): Date {
  const now = new Date();
  const daysFromMonday = (now.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysFromMonday - offsetWeeks * 7
    )
  );
}

async function makeIdempotencyKey(payload: object): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const hashBuf = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST() {
  const apiKey = process.env.ORB_API_KEY;
  if (!apiKey)
    return NextResponse.json({ error: "ORB_API_KEY not set" }, { status: 500 });

  const orbClient = new Orb({ apiKey });
  const authHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    // Fetch the subscription (raw API for full plan/price details)
    const subRes = await fetch(`${ORB_BASE}/subscriptions/${SUBSCRIPTION_ID}`, {
      headers: authHeaders,
    });
    const subData = await subRes.json();
    if (!subRes.ok)
      return NextResponse.json({ error: `Subscription fetch failed: ${JSON.stringify(subData)}` }, { status: 500 });

    const customerId: string = subData.customer.id;

    // Find the license type already configured on the plan's prices
    let licenseTypeId: string | null = null;
    let licenseGroupingKey = "user_email";

    for (const price of subData.plan?.prices ?? []) {
      const config = price.license_type_configuration;
      if (config?.license_type_id) {
        licenseTypeId = config.license_type_id;
        licenseGroupingKey = config.license_grouping_key ?? "user_email";
        break;
      }
    }

    if (!licenseTypeId)
      return NextResponse.json(
        { error: "No license type found on the subscription plan. Ensure the plan has a price with license_type_configuration." },
        { status: 500 }
      );

    // Normal-sounding display names — used as external_license_id so they
    // show up cleanly in the leaderboard
    const users = [
      { name: "Elena Marchetti",  thisWeek: 300000, lastWeek: 180000 },
      { name: "James Okafor",     thisWeek: 200022, lastWeek: 220000 },
      { name: "Priya Suresh",     thisWeek: 123456, lastWeek:  90000 },
      { name: "Tom Bauer",        thisWeek:  67000, lastWeek:  10000 },
      { name: "Anika Johansson",  thisWeek:   5000, lastWeek:  80000 },
    ];

    // Create one license per user (staggered; ignore errors if already exists)
    for (let i = 0; i < users.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch(`${ORB_BASE}/licenses`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          subscription_id: SUBSCRIPTION_ID,
          license_type_id: licenseTypeId,
          external_license_id: users[i].name,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn(`License create for "${users[i].name}" (${res.status}):`, err);
      }
    }

    // ── This week's events (now - 30s so timestamp is safely in the past) ────
    const thisWeekTs = new Date(Date.now() - 30_000).toISOString();

    const thisWeekEvents: Orb.EventIngestParams.Event[] = await Promise.all(
      users.map(async (user) => {
        const base = {
          event_name: "license_api_call",
          properties: { [licenseGroupingKey]: user.name, credits: user.thisWeek },
          timestamp: thisWeekTs,
          customer_id: customerId,
        };
        return { ...base, idempotency_key: await makeIdempotencyKey(base) };
      })
    );

    const thisWeekIngest = await orbClient.events.ingest({
      events: thisWeekEvents,
      debug: true,
    });

    // ── Last week's events via Backfill API ───────────────────────────────────
    const prevWeekStart = getWeekStart(1);
    const prevWeekEnd = getWeekStart(0);

    const prevWeekWed = new Date(prevWeekStart);
    prevWeekWed.setUTCDate(prevWeekStart.getUTCDate() + 2);
    prevWeekWed.setUTCHours(12, 0, 0, 0);
    const prevWeekTs = prevWeekWed.toISOString();

    // 1. Create backfill window
    const backfillRes = await fetch(`${ORB_BASE}/events/backfills`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        timeframe_start: prevWeekStart.toISOString(),
        timeframe_end: prevWeekEnd.toISOString(),
        customer_id: customerId,
      }),
    });
    const backfill = await backfillRes.json();
    if (!backfillRes.ok || !backfill.id)
      return NextResponse.json({ error: `Backfill creation failed: ${JSON.stringify(backfill)}` }, { status: 500 });

    // 2. Ingest last week's events under the backfill
    const prevWeekEvents = await Promise.all(
      users.map(async (user) => {
        const base = {
          event_name: "license_api_call",
          properties: { [licenseGroupingKey]: user.name, credits: user.lastWeek },
          timestamp: prevWeekTs,
          customer_id: customerId,
        };
        return { ...base, idempotency_key: await makeIdempotencyKey(base) };
      })
    );

    const prevWeekIngest = await fetch(
      `${ORB_BASE}/events/ingest?backfill_id=${backfill.id}&debug=true`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ events: prevWeekEvents }),
      }
    ).then((r) => r.json());

    // 3. Close the backfill to commit
    await fetch(`${ORB_BASE}/events/backfills/${backfill.id}/close`, {
      method: "POST",
      headers: authHeaders,
    });

    return NextResponse.json({
      ok: true,
      licenseTypeId,
      licenseGroupingKey,
      thisWeekIngested: thisWeekEvents.length,
      prevWeekIngested: prevWeekEvents.length,
      thisWeekIngest,
      prevWeekIngest,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
