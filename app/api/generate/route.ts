import { NextResponse } from "next/server";
import { Orb } from "orb-billing";

export const maxDuration = 60; // Vercel max for Pro plan

const SUBSCRIPTION_ID = "FGQW6GSocFiMatbF";

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

/** Pick Wednesday noon UTC of a given week start */
function midWeekTimestamp(weekStart: Date): string {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + 2);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

export async function POST() {
  const apiKey = process.env.ORB_API_KEY;
  if (!apiKey)
    return NextResponse.json({ error: "ORB_API_KEY not set" }, { status: 500 });

  const orbClient = new Orb({ apiKey });
  const ts = Math.floor(Date.now() / 1000);

  try {
    // Fetch existing subscription to get customer ID
    const subscription = await orbClient.subscriptions.fetch(SUBSCRIPTION_ID);
    const customerId = subscription.customer.id;

    // Create a new license type
    const licenseRes = await fetch("https://api.withorb.com/v1/license_types", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `Seat ${ts}`, grouping_key: "user_email" }),
    });
    const licenseType = await licenseRes.json();
    if (!licenseRes.ok || !licenseType.id)
      return NextResponse.json(
        { error: `License type creation failed: ${JSON.stringify(licenseType)}` },
        { status: 500 }
      );
    const licenseTypeId: string = licenseType.id;

    // Users — different credit counts per week to produce interesting rank changes
    const users = [
      { email: "wile.e.coyote@acme.com",   thisWeek: 300000, lastWeek: 180000 },
      { email: "bugs.bunny@acme.com",       thisWeek: 200022, lastWeek: 220000 },
      { email: "elena.marchetti@acme.com",  thisWeek: 123456, lastWeek:  90000 },
      { email: "danny.phantom@acme.com",    thisWeek:  67000, lastWeek:  10000 },
      { email: "road.runner@acme.com",      thisWeek:   5000, lastWeek:  80000 },
    ];

    // Create one license per user (staggered to avoid rate limits)
    for (let i = 0; i < users.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch("https://api.withorb.com/v1/licenses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
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

    // Build events for this week and last week
    const thisWeekTs = midWeekTimestamp(getWeekStart(0));
    const prevWeekTs = midWeekTimestamp(getWeekStart(1));

    const events: Orb.EventIngestParams.Event[] = [];
    for (const user of users) {
      for (const [credits, timestamp] of [
        [user.thisWeek, thisWeekTs],
        [user.lastWeek, prevWeekTs],
      ] as [number, string][]) {
        const base = {
          event_name: "license_api_call",
          properties: { user_email: user.email, credits },
          timestamp,
          customer_id: customerId,
        };
        const encoded = new TextEncoder().encode(JSON.stringify(base));
        const hashBuf = await crypto.subtle.digest("SHA-256", encoded);
        const hash = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        events.push({ ...base, idempotency_key: hash });
      }
    }

    const ingestResponse = await orbClient.events.ingest({ events, debug: true });

    return NextResponse.json({
      ok: true,
      licenseTypeId,
      eventsIngested: events.length,
      ingestResponse,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
