import type {
  LeaderboardData,
  Q1User,
  RankedUser,
  WeekSnapshot,
} from "@/types/leaderboard";
import { computeAwards } from "./awards";
import { formatWeekLabel, getQ1Bounds, toDateString } from "./utils";

export const Q1_TARGET = 350_000;

// ─── Orb API types ────────────────────────────────────────────────────────────

interface LicenseType {
  id: string;
  name: string;
  grouping_key: string;
}

interface LicenseUsageRecord {
  license_id: string;
  external_license_id: string;
  subscription_id: string;
  license_type_id: string;
  start_date: string;
  end_date: string;
  allocated_credits: number;
  consumed_credits: number;
  remaining_credits: number;
  pricing_unit: string;
  allocation_eligible_credits: number | null;
  shared_pool_credits: number | null;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchAllLicenseTypes(): Promise<LicenseType[]> {
  const all: LicenseType[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://api.withorb.com/v1/license_types?${params}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.ORB_API_KEY}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Orb API ${res.status}: ${body}`);
    }

    const data = await res.json();
    all.push(...data.data);
    cursor = data.pagination_metadata?.next_cursor ?? null;
  } while (cursor);

  return all;
}

async function fetchLicenseUsage(
  licenseTypeId: string,
  startDate: string,
  endDate: string
): Promise<LicenseUsageRecord[]> {
  const subscriptionId = process.env.ORB_SUBSCRIPTION_ID ?? "";
  const all: LicenseUsageRecord[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({
      subscription_id: subscriptionId,
      license_type_id: licenseTypeId,
      start_date: startDate,
      end_date: endDate,
      group_by: "license",
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `https://api.withorb.com/v1/licenses/usage?${params}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.ORB_API_KEY}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Orb API ${res.status}: ${body}`);
    }

    const data = await res.json();
    all.push(...data.data);
    cursor = data.pagination_metadata?.next_cursor ?? null;
  } while (cursor);

  return all;
}

// ─── Data assembly ────────────────────────────────────────────────────────────

type UsageMap = Map<string, { displayName: string; consumed: number }>;

function buildUsageMap(records: LicenseUsageRecord[]): UsageMap {
  const map: UsageMap = new Map();
  for (const r of records) {
    const key = r.external_license_id ?? r.license_id;
    const existing = map.get(key);
    if (existing) {
      existing.consumed += r.consumed_credits;
    } else {
      map.set(key, {
        displayName: r.external_license_id ?? r.license_id,
        consumed: r.consumed_credits,
      });
    }
  }
  return map;
}

function rankUsageMap(
  usageMap: UsageMap
): { id: string; displayName: string; creditsUsed: number; rank: number }[] {
  return Array.from(usageMap.entries())
    .map(([id, { displayName, consumed }]) => ({
      id,
      displayName,
      creditsUsed: consumed,
    }))
    .sort((a, b) => b.creditsUsed - a.creditsUsed)
    .map((u, i) => ({ ...u, rank: i + 1 }));
}

async function fetchUsageForDateRange(
  licenseTypes: LicenseType[],
  startDate: string,
  endDate: string
): Promise<UsageMap> {
  const allRecords = (
    await Promise.all(
      licenseTypes.map((lt) => fetchLicenseUsage(lt.id, startDate, endDate))
    )
  ).flat();

  return buildUsageMap(allRecords);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getLeaderboardData(
  weekStart: Date,
  weekEnd: Date
): Promise<LeaderboardData> {
  const startDate = toDateString(weekStart);
  const endDate = toDateString(weekEnd);

  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const prevWeekEnd = new Date(weekEnd);
  prevWeekEnd.setUTCDate(weekEnd.getUTCDate() - 7);
  const prevStartDate = toDateString(prevWeekStart);
  const prevEndDate = toDateString(prevWeekEnd);

  const q1 = getQ1Bounds();
  const q1StartDate = toDateString(q1.start);
  const q1EndDate = toDateString(q1.end);

  // Step 1: get license types (required prerequisite)
  const licenseTypes = await fetchAllLicenseTypes();

  // Step 2: fetch current week, prev week, Q1 in parallel
  const [currentMap, prevMap, q1Map] = await Promise.all([
    fetchUsageForDateRange(licenseTypes, startDate, endDate),
    fetchUsageForDateRange(licenseTypes, prevStartDate, prevEndDate),
    fetchUsageForDateRange(licenseTypes, q1StartDate, q1EndDate),
  ]);

  const currentRanked = rankUsageMap(currentMap);
  const prevRanked = rankUsageMap(prevMap);
  const prevRankLookup = new Map(prevRanked.map((u) => [u.id, u.rank]));

  const currentSnapshot: WeekSnapshot = {
    weekStart,
    rankedUsers: currentRanked.map((u) => ({
      externalCustomerId: u.id,
      displayName: u.displayName,
      rank: u.rank,
    })),
  };
  const prevSnapshot: WeekSnapshot = {
    weekStart: prevWeekStart,
    rankedUsers: prevRanked.map((u) => ({
      externalCustomerId: u.id,
      displayName: u.displayName,
      rank: u.rank,
    })),
  };

  const awards = computeAwards(currentSnapshot, prevSnapshot);

  const kothWinner = awards.kingOfTheHill?.winner ?? null;
  const moverWinner = awards.moverAndShaker?.winner ?? null;
  const battleWinnerString = awards.battleRoyale?.winner ?? null;
  const battleNames = battleWinnerString
    ? battleWinnerString.split(" vs. ")
    : [];

  const users: RankedUser[] = currentRanked.map((u) => {
    const prevRank = prevRankLookup.get(u.id) ?? null;
    const rankChange = prevRank !== null ? prevRank - u.rank : null;

    const tags = [];
    if (u.displayName === kothWinner) {
      tags.push({ type: "king" as const, label: "👑 KOTH" });
    }
    if (u.displayName === moverWinner) {
      tags.push({ type: "mover" as const, label: "🚀 MOVER" });
    }
    if (battleNames.includes(u.displayName)) {
      tags.push({ type: "battle" as const, label: "⚔️ BATTLE" });
    }

    return {
      id: u.id,
      externalCustomerId: u.id,
      displayName: u.displayName,
      creditsUsed: u.creditsUsed,
      rank: u.rank,
      prevRank,
      rankChange,
      tags,
    };
  });

  const q1Ranked = rankUsageMap(q1Map);
  const q1Progress: Q1User[] = q1Ranked.slice(0, 3).map((u) => ({
    externalCustomerId: u.id,
    displayName: u.displayName,
    creditsUsed: u.creditsUsed,
    target: Q1_TARGET,
    percentage: Math.min(100, Math.round((u.creditsUsed / Q1_TARGET) * 100)),
  }));

  return {
    weekLabel: formatWeekLabel(weekStart, weekEnd),
    users,
    awards,
    q1Progress,
  };
}
