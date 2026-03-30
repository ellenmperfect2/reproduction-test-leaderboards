import { getLeaderboardData } from "@/lib/orb";
import { getCurrentWeekBounds, toDateString } from "@/lib/utils";
import AwardsRow from "@/components/leaderboard/AwardsRow";
import LeaderboardTable from "@/components/leaderboard/LeaderboardTable";
import ProgressSection from "@/components/leaderboard/ProgressSection";
import DateRangePicker from "@/components/leaderboard/DateRangePicker";
import GenerateButton from "@/components/leaderboard/GenerateButton";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const params = await searchParams;
  const defaultWeek = getCurrentWeekBounds();

  const weekStart = params.start
    ? new Date(params.start + "T00:00:00Z")
    : defaultWeek.start;
  const weekEnd = params.end
    ? new Date(params.end + "T00:00:00Z")
    : defaultWeek.end;

  const isCurrentWeek =
    toDateString(weekStart) === toDateString(defaultWeek.start);

  const data = await getLeaderboardData(weekStart, weekEnd);

  return (
    <div className="relative z-10 min-h-screen px-4 py-8 sm:px-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1
          className="font-playfair font-bold text-3xl sm:text-4xl mb-1"
          style={{ color: "#1a1040" }}
        >
          AI Adoption Leaderboard
        </h1>
        <p className="text-sm" style={{ color: "#5a5070" }}>
          Credits consumed · Powered by Orb
        </p>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between mb-6">
        <DateRangePicker
          startDate={toDateString(weekStart)}
          endDate={toDateString(weekEnd)}
          weekLabel={data.weekLabel}
          isCurrentWeek={isCurrentWeek}
        />
        <GenerateButton />
      </div>

      {/* Award cards */}
      <div className="mb-6">
        <AwardsRow awards={data.awards} />
      </div>

      {/* Leaderboard table */}
      <div className="mb-6">
        <h2
          className="font-playfair font-semibold text-lg mb-3"
          style={{ color: "#1a1040" }}
        >
          This Week&apos;s Rankings
        </h2>
        <LeaderboardTable users={data.users} />
      </div>

      {/* Q1 progress */}
      <ProgressSection q1Progress={data.q1Progress} />
    </div>
  );
}
