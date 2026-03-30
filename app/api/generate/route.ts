import { NextResponse } from "next/server";
import { Orb } from "orb-billing";

export const maxDuration = 60;

const SEED_SUBSCRIPTION_ID = "FGQW6GSocFiMatbF"; // used only to look up the customer
const ORB_BASE = "https://api.withorb.com/v1";

const USERS = [
  { name: "Elena Marchetti", thisWeek: 300000, lastWeek: 180000 },
  { name: "James Okafor",    thisWeek: 200022, lastWeek: 220000 },
  { name: "Priya Suresh",    thisWeek: 123456, lastWeek:  90000 },
  { name: "Tom Bauer",       thisWeek:  67000, lastWeek:  10000 },
  { name: "Anika Johansson", thisWeek:   5000, lastWeek:  80000 },
];

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

// ─── helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

async function orbGet(path: string, apiKey: string): Promise<{ ok: boolean; status: number; data: AnyJson }> {
  const res = await fetch(`${ORB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  return { ok: res.ok, status: res.status, data: await res.json() };
}

async function orbPost(path: string, body: object, apiKey: string): Promise<{ ok: boolean; status: number; data: AnyJson }> {
  const res = await fetch(`${ORB_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json() };
}

// ─── license type discovery ───────────────────────────────────────────────────

interface LicenseTypeConfig { licenseTypeId: string; groupingKey: string }

/** Return the first license_type_configuration found on any price in the plan. */
function extractLicenseTypeConfig(planPrices: AnyJson[]): LicenseTypeConfig | null {
  for (const price of planPrices ?? []) {
    // The field can appear at the top level or nested under the price model key
    const candidates = [price, ...Object.values(price)];
    for (const obj of candidates) {
      if (obj && typeof obj === "object" && "license_type_configuration" in obj) {
        const cfg = (obj as AnyJson).license_type_configuration;
        if (cfg?.license_type_id) {
          return { licenseTypeId: cfg.license_type_id, groupingKey: cfg.license_grouping_key ?? "user_email" };
        }
      }
    }
  }
  return null;
}

// ─── main ─────────────────────────────────────────────────────────────────────

export async function POST() {
  const apiKey = process.env.ORB_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ORB_API_KEY not set" }, { status: 500 });

  const orbClient = new Orb({ apiKey });
  const ts = Math.floor(Date.now() / 1000);

  // ── Step 1: resolve customer + subscription ──────────────────────────────────
  let subscriptionId = process.env.ORB_SUBSCRIPTION_ID ?? SEED_SUBSCRIPTION_ID;
  let customerId: string;
  let licenseConfig: LicenseTypeConfig | null = null;
  let needsEnvUpdate = false;

  {
    const { ok, data } = await orbGet(`/subscriptions/${subscriptionId}`, apiKey);
    if (!ok) return NextResponse.json({ error: `Failed to fetch subscription: ${JSON.stringify(data)}` }, { status: 500 });
    customerId = data.customer?.id;
    licenseConfig = extractLicenseTypeConfig(data.plan?.prices ?? []);
  }

  // ── Step 2: if no license type on existing plan, build one ───────────────────
  if (!licenseConfig) {
    // Find or create a billable metric
    let metricId: string;
    let metricItemId: string;

    const { data: metricsData } = await orbGet("/metrics?limit=100", apiKey);
    const existing = metricsData?.data?.find((m: AnyJson) =>
      m.name === "License API Calls" || m.event_name === "license_api_call"
    );

    if (existing) {
      metricId = existing.id;
      metricItemId = existing.item?.id;
    } else {
      const { ok, data } = await orbPost("/metrics", {
        name: "License API Calls",
        event_name: "license_api_call",
        item_name: "License API Calls",
        sql: "SELECT SUM(credits) FROM events WHERE event_name = 'license_api_call'",
      }, apiKey);
      if (!ok || !data.id)
        return NextResponse.json({ error: `Metric creation failed: ${JSON.stringify(data)}` }, { status: 500 });
      metricId = data.id;
      metricItemId = data.item?.id;
    }

    // Create item for seat price
    const { ok: itemOk, data: itemData } = await orbPost("/items", { name: `Seats ${ts}` }, apiKey);
    if (!itemOk || !itemData.id)
      return NextResponse.json({ error: `Item creation failed: ${JSON.stringify(itemData)}` }, { status: 500 });
    const itemId: string = itemData.id;

    // Create license type
    const { ok: ltOk, data: ltData } = await orbPost("/license_types", {
      name: `Seat ${ts}`, grouping_key: "user_email",
    }, apiKey);
    if (!ltOk || !ltData.id)
      return NextResponse.json({ error: `License type creation failed: ${JSON.stringify(ltData)}` }, { status: 500 });
    const licenseTypeId: string = ltData.id;
    const groupingKey = "user_email";

    // Create plan with license allocation + usage prices
    const { ok: planOk, data: planData } = await orbPost("/plans", {
      name: `Leaderboard Demo Plan ${ts}`,
      currency: "USD",
      net_terms: 0,
      prices: [
        {
          license_allocation_price: {
            name: "Seats",
            item_id: itemId,
            cadence: "monthly",
            model_type: "unit",
            unit_config: { unit_amount: "350000" },
            fixed_price_quantity: USERS.length,
            billed_in_advance: true,
            license_type_configuration: { license_type_id: licenseTypeId, license_grouping_key: groupingKey },
            license_allocations: [{ currency: "USD", amount: "350000" }],
          },
        },
        {
          price: {
            name: "API Calls",
            item_id: metricItemId,
            billable_metric_id: metricId,
            cadence: "monthly",
            model_type: "unit",
            unit_config: { unit_amount: "1.00" },
            billed_in_advance: false,
            license_type_configuration: { license_type_id: licenseTypeId, license_grouping_key: groupingKey },
          },
        },
      ],
    }, apiKey);
    if (!planOk || !planData.id)
      return NextResponse.json({ error: `Plan creation failed: ${JSON.stringify(planData)}` }, { status: 500 });

    // Create subscription for the same customer
    const today = new Date().toISOString().split("T")[0];
    const { ok: subOk, data: subData } = await orbPost("/subscriptions", {
      customer_id: customerId,
      plan_id: planData.id,
      start_date: today,
    }, apiKey);
    if (!subOk || !subData.id)
      return NextResponse.json({ error: `Subscription creation failed: ${JSON.stringify(subData)}` }, { status: 500 });

    subscriptionId = subData.id;
    licenseConfig = { licenseTypeId, groupingKey };
    needsEnvUpdate = true;
  }

  const { licenseTypeId, groupingKey } = licenseConfig;

  // ── Step 3: create licenses (ignore errors if already exist) ─────────────────
  for (let i = 0; i < USERS.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1000));
    await orbPost("/licenses", {
      subscription_id: subscriptionId,
      license_type_id: licenseTypeId,
      external_license_id: USERS[i].name,
    }, apiKey);
  }

  // ── Step 4: ingest this week's events ────────────────────────────────────────
  const thisWeekTs = new Date(Date.now() - 30_000).toISOString();
  const thisWeekEvents: Orb.EventIngestParams.Event[] = await Promise.all(
    USERS.map(async user => {
      const base = { event_name: "license_api_call", properties: { [groupingKey]: user.name, credits: user.thisWeek }, timestamp: thisWeekTs, customer_id: customerId };
      return { ...base, idempotency_key: await sha256(base) };
    })
  );
  await orbClient.events.ingest({ events: thisWeekEvents, debug: true });

  // ── Step 5: ingest last week's events via Backfill API ───────────────────────
  const prevWeekStart = getWeekStart(1);
  const prevWeekEnd   = getWeekStart(0);
  const prevWeekWed   = new Date(prevWeekStart);
  prevWeekWed.setUTCDate(prevWeekStart.getUTCDate() + 2);
  prevWeekWed.setUTCHours(12, 0, 0, 0);

  const { ok: bfOk, data: bfData } = await orbPost("/events/backfills", {
    timeframe_start: prevWeekStart.toISOString(),
    timeframe_end:   prevWeekEnd.toISOString(),
    customer_id:     customerId,
  }, apiKey);
  if (!bfOk || !bfData.id)
    return NextResponse.json({ error: `Backfill creation failed: ${JSON.stringify(bfData)}` }, { status: 500 });

  const prevWeekEvents = await Promise.all(
    USERS.map(async user => {
      const base = { event_name: "license_api_call", properties: { [groupingKey]: user.name, credits: user.lastWeek }, timestamp: prevWeekWed.toISOString(), customer_id: customerId };
      return { ...base, idempotency_key: await sha256(base) };
    })
  );
  await orbPost(`/events/ingest?backfill_id=${bfData.id}&debug=true`, { events: prevWeekEvents }, apiKey);
  await orbPost(`/events/backfills/${bfData.id}/close`, {}, apiKey);

  return NextResponse.json({
    ok: true,
    subscriptionId,
    needsEnvUpdate,
    eventsIngested: thisWeekEvents.length + prevWeekEvents.length,
  });
}
