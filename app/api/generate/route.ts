import { NextResponse } from "next/server";

export const maxDuration = 60;

// Stable subscription — never recreated. Override via ORB_SUBSCRIPTION_ID env var.
const SUBSCRIPTION_ID = process.env.ORB_SUBSCRIPTION_ID ?? "BQ3XwoXSGrme9h4m";
const ORB_BASE = "https://api.withorb.com/v1";
const GROUPING_KEY = "user_name";

const USERS = [
  { name: "Elena Marchetti",  thisWeek: 300_000, lastWeek: 180_000 },
  { name: "James Okafor",     thisWeek: 200_022, lastWeek: 220_000 },
  { name: "Priya Suresh",     thisWeek: 123_456, lastWeek:  90_000 },
  { name: "Tom Bauer",        thisWeek:  67_000, lastWeek:  10_000 },
  { name: "Anika Johansson",  thisWeek:   5_000, lastWeek:  80_000 },
  { name: "Carlos Reyes",     thisWeek:  45_000, lastWeek:  55_000 },
  { name: "Sophie Dubois",    thisWeek:  30_000, lastWeek:  25_000 },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

function getWeekStart(offsetWeeks = 0): Date {
  const now = new Date();
  const daysFromMonday = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(),
    now.getUTCDate() - daysFromMonday - offsetWeeks * 7,
  ));
}

async function sha256(payload: object): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function orbGet(path: string, apiKey: string): Promise<{ ok: boolean; data: AnyJson }> {
  const res = await fetch(`${ORB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  return { ok: res.ok, data: await res.json() };
}

async function orbPost(path: string, body: object, apiKey: string): Promise<{ ok: boolean; data: AnyJson }> {
  const res = await fetch(`${ORB_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json() };
}

export async function POST() {
  const apiKey = process.env.ORB_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ORB_API_KEY not set" }, { status: 500 });

  // ── Step 1: fetch subscription → customer ID + license type ─────────────────
  const { ok, data: sub } = await orbGet(`/subscriptions/${SUBSCRIPTION_ID}`, apiKey);
  if (!ok) return NextResponse.json({ error: `Failed to fetch subscription: ${JSON.stringify(sub)}` }, { status: 500 });

  const customerId: string = sub.customer?.id;
  if (!customerId) return NextResponse.json({ error: "Could not resolve customer ID from subscription." }, { status: 500 });

  let licenseTypeId: string | null = null;
  for (const price of sub.plan?.prices ?? []) {
    if (price?.license_type?.id) { licenseTypeId = price.license_type.id; break; }
  }
  if (!licenseTypeId) return NextResponse.json({ error: "No license_type found on this subscription's plan." }, { status: 500 });

  // ── Step 2: ensure licenses exist (idempotent) ───────────────────────────────
  for (let i = 0; i < USERS.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 500));
    await orbPost("/licenses", {
      subscription_id: SUBSCRIPTION_ID,
      license_type_id: licenseTypeId,
      external_license_id: USERS[i].name,
    }, apiKey);
  }

  // ── Step 3: build events with stable per-week timestamps ─────────────────────
  // Using fixed timestamps (Monday 00:01 / Wednesday 12:00) means idempotency
  // keys are identical on repeated clicks within the same week → duplicate detection.
  const thisWeekMonday = getWeekStart(0);
  const thisWeekTs = new Date(thisWeekMonday.getTime() + 60_000).toISOString(); // Mon 00:01 UTC

  const prevWeekMonday = getWeekStart(1);
  const prevWeekWed = new Date(prevWeekMonday);
  prevWeekWed.setUTCDate(prevWeekMonday.getUTCDate() + 2);
  prevWeekWed.setUTCHours(12, 0, 0, 0);
  const prevWeekTs = prevWeekWed.toISOString();

  const makeEvents = (users: typeof USERS, field: "thisWeek" | "lastWeek", ts: string) =>
    Promise.all(users.map(async user => {
      const base = { event_name: "license_api_call", properties: { [GROUPING_KEY]: user.name, credits: user[field] }, timestamp: ts, customer_id: customerId };
      return { ...base, idempotency_key: await sha256(base) };
    }));

  // ── Step 4: ingest this week ─────────────────────────────────────────────────
  const thisWeekEvents = await makeEvents(USERS, "thisWeek", thisWeekTs);
  const { data: thisResult } = await orbPost("/events/ingest?debug=true", { events: thisWeekEvents }, apiKey);
  const thisIngested = thisResult?.debug?.ingested?.length ?? 0;
  const thisDupes    = thisResult?.debug?.duplicate?.length ?? 0;

  // ── Step 5: ingest last week via backfill ────────────────────────────────────
  const prevWeekEnd = getWeekStart(0);
  const { ok: bfOk, data: bfData } = await orbPost("/events/backfills", {
    timeframe_start: prevWeekMonday.toISOString(),
    timeframe_end:   prevWeekEnd.toISOString(),
    customer_id:     customerId,
  }, apiKey);

  let prevIngested = 0;
  let prevDupes    = 0;
  if (bfOk && bfData.id) {
    const prevWeekEvents = await makeEvents(USERS, "lastWeek", prevWeekTs);
    const { data: prevResult } = await orbPost(`/events/ingest?backfill_id=${bfData.id}&debug=true`, { events: prevWeekEvents }, apiKey);
    prevIngested = prevResult?.debug?.ingested?.length ?? 0;
    prevDupes    = prevResult?.debug?.duplicate?.length ?? 0;
    await orbPost(`/events/backfills/${bfData.id}/close`, {}, apiKey);
  }

  const totalIngested = thisIngested + prevIngested;
  const totalDupes    = thisDupes + prevDupes;
  const upToDate      = totalIngested === 0 && totalDupes > 0;

  return NextResponse.json({ ok: true, upToDate, eventsIngested: totalIngested });
}
