import type { AwardData, Awards, WeekSnapshot } from "@/types/leaderboard";

export function computeKOTH(
  currentWeek: WeekSnapshot,
  timeline: WeekSnapshot[]
): AwardData | null {
  const leader = currentWeek.rankedUsers.find((u) => u.rank === 1);
  if (!leader) return null;

  let streak = 0;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const top = timeline[i].rankedUsers.find((u) => u.rank === 1);
    if (top?.externalCustomerId === leader.externalCustomerId) streak++;
    else break;
  }

  return {
    winner: leader.displayName,
    description:
      streak >= 3
        ? `#1 for ${streak} weeks straight`
        : streak === 2
        ? "#1 two weeks running"
        : "#1 this week",
  };
}

export function computeMoverAndShaker(
  currentWeek: WeekSnapshot,
  previousWeek: WeekSnapshot
): AwardData | null {
  const prevRankMap = new Map<string, number>();
  for (const u of previousWeek.rankedUsers) {
    prevRankMap.set(u.externalCustomerId, u.rank);
  }

  let bestImprovement = 0;
  let winner: string | null = null;

  for (const u of currentWeek.rankedUsers) {
    const prevRank = prevRankMap.get(u.externalCustomerId);
    if (prevRank === undefined) continue;
    const improvement = prevRank - u.rank;
    if (improvement > bestImprovement) {
      bestImprovement = improvement;
      winner = u.displayName;
    }
  }

  if (!winner || bestImprovement <= 0) return null;

  return {
    winner,
    description: `Climbed ${bestImprovement} place${bestImprovement !== 1 ? "s" : ""} this week`,
  };
}

export function computeBattleRoyale(
  currentWeek: WeekSnapshot,
  previousWeek: WeekSnapshot
): AwardData | null {
  const prevRankMap = new Map<string, number>();
  for (const u of previousWeek.rankedUsers) {
    prevRankMap.set(u.externalCustomerId, u.rank);
  }

  const current = currentWeek.rankedUsers;
  let bestCombinedGap = Infinity;
  let winnerPair: [string, string] | null = null;

  for (let i = 0; i < current.length; i++) {
    for (let j = i + 1; j < current.length; j++) {
      const a = current[i];
      const b = current[j];
      const curGap = Math.abs(a.rank - b.rank);
      if (curGap > 2) continue;

      const prevA = prevRankMap.get(a.externalCustomerId);
      const prevB = prevRankMap.get(b.externalCustomerId);
      if (prevA === undefined || prevB === undefined) continue;

      const prevGap = Math.abs(prevA - prevB);
      if (prevGap > 2) continue;

      const combinedGap = curGap + prevGap;
      if (combinedGap < bestCombinedGap) {
        bestCombinedGap = combinedGap;
        winnerPair = [a.displayName, b.displayName];
      }
    }
  }

  if (!winnerPair) return null;

  return {
    winner: `${winnerPair[0]} vs. ${winnerPair[1]}`,
    description: "Neck and neck both weeks",
  };
}

export function computeAwards(
  currentWeek: WeekSnapshot,
  previousWeek: WeekSnapshot,
  historicalSnapshots: WeekSnapshot[] = []
): Awards {
  const timeline = [...historicalSnapshots, previousWeek, currentWeek];

  return {
    kingOfTheHill: computeKOTH(currentWeek, timeline),
    moverAndShaker: computeMoverAndShaker(currentWeek, previousWeek),
    battleRoyale: computeBattleRoyale(currentWeek, previousWeek),
  };
}
