/**
 * generate-example-data.ts
 * Writes example license and event data into an existing Orb subscription.
 * Does NOT create a customer, item, plan, or subscription — those already exist.
 *
 * Run with: npm run generate
 */

import "dotenv/config";
import { Orb } from "orb-billing";

function unixTimestampNow(): number {
  return Math.floor(Date.now() / 1000);
}

const apiKey = process.env.ORB_API_KEY;
if (!apiKey) throw new Error("ORB_API_KEY environment variable is not set");

const SUBSCRIPTION_ID = "FGQW6GSocFiMatbF";

const orbClient = new Orb({ apiKey });

async function main() {
  const timeStamp = unixTimestampNow();

  // Fetch the existing subscription to get the customer ID
  const subscription = await orbClient.subscriptions.fetch(SUBSCRIPTION_ID);
  const customerId = subscription.customer.id;
  console.log(`Using subscription: ${SUBSCRIPTION_ID}`);
  console.log(`Using customer:     ${customerId}`);

  // Create a license type
  const licenseGroupingKey = "user_email";
  const licenseRes = await fetch("https://api.withorb.com/v1/license_types", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `Seat ${timeStamp}`,
      grouping_key: licenseGroupingKey,
    }),
  });
  const licenseType = await licenseRes.json();
  if (!licenseRes.ok || !licenseType.id) {
    throw new Error(`License type creation failed: ${JSON.stringify(licenseType)}`);
  }
  const licenseTypeId = licenseType.id;
  console.log(`License type created: ${licenseTypeId}`);

  // Create one license per user
  const userEventCounts: [string, number][] = [
    ["wile.e.coyote@acme.com",   300000],
    ["bugs.bunny@acme.com",      200022],
    ["elena.marchetti@acme.com", 123456],
    ["danny.phantom@acme.com",   67],
    ["road.runner@acme.com",     5],
  ];

  console.log("Creating licenses...");
  const licenseMap = new Map<string, string>(
    await Promise.all(
      userEventCounts.map(async ([userEmail], i): Promise<[string, string]> => {
        await new Promise((resolve) => setTimeout(resolve, i * 3000));
        const res = await fetch("https://api.withorb.com/v1/licenses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subscription_id: SUBSCRIPTION_ID,
            license_type_id: licenseTypeId,
            external_license_id: userEmail,
          }),
        });
        const license = await res.json();
        if (!res.ok || !license.id) {
          console.error(
            `Failed to create license for ${userEmail} (${res.status}):`,
            JSON.stringify(license)
          );
        }
        return [userEmail, license.id];
      })
    )
  );

  // Ingest events
  const timestamp = new Date().toISOString();
  const events: Orb.EventIngestParams.Event[] = await Promise.all(
    userEventCounts.map(async ([userEmail, credits]) => {
      const eventNoIdempotency = {
        event_name: "license_api_call",
        properties: { user_email: userEmail, credits },
        timestamp,
        customer_id: customerId,
      };

      const data = new TextEncoder().encode(JSON.stringify(eventNoIdempotency));
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      return { ...eventNoIdempotency, idempotency_key: hash };
    })
  );

  const response = await orbClient.events.ingest({ events, debug: true });
  console.log(`Ingested ${events.length} events:`, response);

  console.log(`\nDone!`);
  console.log(`  subscription_id: ${SUBSCRIPTION_ID}`);
  console.log(`  license_type_id: ${licenseTypeId}`);
  console.log(`  licenses:`);
  for (const [email, licenseId] of licenseMap) {
    console.log(`    ${email} -> ${licenseId}`);
  }
}

main().catch(console.error);
