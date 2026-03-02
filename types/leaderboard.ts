export interface RankedUser {
  id: string;
  externalCustomerId: string;
  displayName: string;
  creditsUsed: number;
  rank: number;
  prevRank: number | null;
  rankChange: number | null; // positive = moved up, negative = dropped
  tags: UserTag[];
}

export type UserTagType = "king" | "mover" | "battle";

export interface UserTag {
  type: UserTagType;
  label: string;
}

export interface AwardData {
  winner: string;
  description: string;
}

export interface Awards {
  kingOfTheHill: AwardData | null;
  moverAndShaker: AwardData | null;
  battleRoyale: AwardData | null;
}

export interface Q1User {
  externalCustomerId: string;
  displayName: string;
  creditsUsed: number;
  target: number;
  percentage: number;
}

export interface LeaderboardData {
  weekLabel: string;
  users: RankedUser[];
  awards: Awards;
  q1Progress: Q1User[];
}

export interface WeekSnapshot {
  weekStart: Date;
  rankedUsers: { externalCustomerId: string; displayName: string; rank: number }[];
}
