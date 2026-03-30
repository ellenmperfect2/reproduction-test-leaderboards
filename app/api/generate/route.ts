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
  const ts = Math.floor(Date.now() / 1000);
  const authHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  try {
    // Fetch existing subscription to get customer ID
    const subscription = await orbClient.subscriptions.fetch(SUBSCRIPTION_ID);
    const customerId = subscription.customer.id;

    // Create a new license type
    const licenseRes = await fetch(`${ORB_BASE}/license_types`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: `Seat ${ts}`, grouping_key: "user_email" }),
    });
    const licenseType = await licenseRes.json();
    if (!licenseRes.ok || !licenseType.id)
      return NextResponse.json(
        { error: `License type creation failed: ${JSON.stringify(licenseType)}` },
        { status: 500 }
      );
    const licenseTypeId: string = licenseType.id;

    // Users — different credits per week to produce visible rank changes
    const users = [
      { email: "wile.e.coyote@acme.com",  thisWeek: 300000, lastWeek: 180000 },
      { email: "bugs.bunny@acme.com",      thisWeek: 200022, lastWeek: 220000 },
      { email: "elena.marchetti@acme.com", thisWeek: 123456, lastWeek:  90000 },
      { email: "danny.phantom@acme.com",   thisWeek:  67000, lastWeek:  10000 },
      { email: "road.runner@acme.com",     thisWeek:   5000, lastWeek:  80000 },
    ];

    // Create one license per user (staggered to avoid rate limits)
    for (let i = 0; i < users.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch(`${ORB_BASE}/licenses`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          subscription_id: SUBSCRIPTION_ID,
          license_type_id: licenseTypeId,
          external_license_id: users[i].email,
        }),
      });
      const license = await res.json();
      if (!res.ok || !license.id)
        console.error(`License creation failed for ${users[i].email}:`, license);
    }

    // ── This week's events ────────────────────────────────────────────────────
    // Use now-minus-30s so the timestamp is safely in the past
    const thisWeekTs = new Date(Date.now() - 30_000).toISOString();

    const thisWeekEvents: Orb.EventIngestParams.Event[] = await Promise.all(
      users.map(async (user) => {
        const base = {
          event_name: "license_api_call",
          properties: { user_email: user.email, credits: user.thisWeek },
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
    const prevWeekEnd = getWeekStart(0); // exclusive — start of this week

    // Wednesday noon UTC of last week — safely within the backfill window
    const prevWeekWed = new Date(prevWeekStart);
    prevWeekWed.setUTCDate(prevWeekStart.getUTCDate() + 2);
    prevWeekWed.setUTCHours(12, 0, 0, 0);
    const prevWeekTs = prevWeekWed.toISOString();

    // 1. Create backfill
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
      return NextResponse.json(
        { error: `Backfill creation failed: ${JSON.stringify(backfill)}` },
        { status: 500 }
      );
    const backfillId: string = backfill.id;

    // 2. Ingest last week's events under the backfill
    const prevWeekEvents = await Promise.all(
      users.map(async (user) => {
        const base = {
          event_name: "license_api_call",
          properties: { user_email: user.email, credits: user.lastWeek },
          timestamp: prevWeekTs,
          customer_id: customerId,
        };
        return { ...base, idempotency_key: await makeIdempotencyKey(base) };
      })
    );

    const prevWeekIngest = await fetch(
      `${ORB_BASE}/events/ingest?backfill_id=${backfillId}&debug=true`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ events: prevWeekEvents }),
      }
    ).then((r) => r.json());

    // 3. Close the backfill to commit the events
    await fetch(`${ORB_BASE}/events/backfills/${backfillId}/close`, {
      method: "POST",
      headers: authHeaders,
    });

    return NextResponse.json({
      ok: true,
      licenseTypeId,
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
