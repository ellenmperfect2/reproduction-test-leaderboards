import type { Q1User } from "@/types/leaderboard";
import { Q1_TARGET } from "@/lib/orb";
import { formatCredits } from "@/lib/utils";

interface ProgressSectionProps {
  q1Progress: Q1User[];
}

const barGradients = [
  "linear-gradient(90deg, #2563a8, #60a5fa)",
  "linear-gradient(90deg, #2d6e3e, #4ade80)",
  "linear-gradient(90deg, #c0392b, #f87171)",
];

export default function ProgressSection({ q1Progress }: ProgressSectionProps) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{
        background: "rgba(255,255,255,0.6)",
        backdropFilter: "blur(4px)",
        borderColor: "rgba(26,16,64,0.1)",
      }}
    >
      <h2
        className="font-playfair font-semibold text-lg mb-1"
        style={{ color: "#1a1040" }}
      >
        Q1 Incentive Progress
      </h2>
      <p className="text-xs mb-5" style={{ color: "#8a80a0" }}>
        Top users by credits consumed since Jan 1
      </p>

      <div className="flex flex-col gap-5">
        {q1Progress.map((user, index) => (
          <div key={user.externalCustomerId}>
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="font-medium text-sm" style={{ color: "#1a1040" }}>
                {user.displayName}
              </span>
              <span className="text-xs" style={{ color: "#5a5070" }}>
                {formatCredits(user.creditsUsed)} / {formatCredits(Q1_TARGET)} credits
              </span>
            </div>

            <div
              className="h-2.5 rounded-full overflow-hidden"
              style={{ background: "rgba(26,16,64,0.08)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${user.percentage}%`,
                  background: barGradients[index] ?? barGradients[0],
                }}
              />
            </div>

            <div className="flex justify-between mt-1">
              <span className="text-xs" style={{ color: "#8a80a0" }}>Jan 1</span>
              <span className="text-xs" style={{ color: "#8a80a0" }}>Mar 31</span>
            </div>
          </div>
        ))}

        {q1Progress.length === 0 && (
          <p className="text-sm text-center" style={{ color: "#8a80a0" }}>
            No Q1 data available.
          </p>
        )}
      </div>
    </div>
  );
}
