import type { RankedUser, UserTag } from "@/types/leaderboard";
import { formatCredits } from "@/lib/utils";

interface LeaderboardTableProps {
  users: RankedUser[];
}

function PlaceBadge({ rank }: { rank: number }) {
  let style: React.CSSProperties;

  if (rank === 1) {
    style = {
      background: "linear-gradient(135deg, rgba(212,175,55,0.3), rgba(240,208,80,0.2))",
      color: "#9a7a08",
    };
  } else if (rank === 2) {
    style = {
      background: "rgba(160,160,180,0.2)",
      color: "#5a5a7a",
    };
  } else if (rank === 3) {
    style = {
      background: "rgba(176,125,80,0.2)",
      color: "#7a4820",
    };
  } else {
    style = {
      background: "rgba(26,16,64,0.07)",
      color: "#8a80a0",
    };
  }

  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold text-sm"
      style={{ width: 28, height: 28, ...style }}
    >
      {rank}
    </span>
  );
}

function RankChangeBadge({ change }: { change: number | null }) {
  if (change === null) {
    return <span style={{ color: "#8a80a0" }}>—</span>;
  }
  if (change > 0) {
    return (
      <span style={{ color: "#2d6e3e", fontWeight: 700 }}>
        ▲ {change}
      </span>
    );
  }
  if (change < 0) {
    return (
      <span style={{ color: "#c0392b", fontWeight: 700 }}>
        ▼ {Math.abs(change)}
      </span>
    );
  }
  return <span style={{ color: "#8a80a0" }}>—</span>;
}

const tagStyles: Record<string, React.CSSProperties> = {
  king: { background: "rgba(212,175,55,0.2)", color: "#9a7a08" },
  mover: { background: "rgba(37,99,168,0.14)", color: "#2563a8" },
  battle: { background: "rgba(192,57,43,0.14)", color: "#c0392b" },
};

function TagBadge({ tag }: { tag: UserTag }) {
  return (
    <span
      className="inline-block rounded-full"
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 20,
        ...tagStyles[tag.type],
      }}
    >
      {tag.label}
    </span>
  );
}

export default function LeaderboardTable({ users }: LeaderboardTableProps) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.6)",
        backdropFilter: "blur(4px)",
        borderColor: "rgba(26,16,64,0.1)",
      }}
    >
      {/* Header */}
      <div
        className="grid grid-cols-[40px_1fr_80px_80px] sm:grid-cols-[40px_1fr_120px_120px] gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "#8a80a0", borderBottom: "1px solid rgba(26,16,64,0.08)" }}
      >
        <span>#</span>
        <span>Name</span>
        <span className="text-right">Change</span>
        <span className="text-right">Credits</span>
      </div>

      {/* Rows */}
      {users.map((user) => (
        <div
          key={user.id}
          className="lb-row grid grid-cols-[40px_1fr_80px_80px] sm:grid-cols-[40px_1fr_120px_120px] gap-4 px-5 py-3.5 items-center transition-colors"
          style={{ borderBottom: "1px solid rgba(26,16,64,0.06)" }}
        >
          <PlaceBadge rank={user.rank} />

          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-medium text-[#1a1040] truncate">{user.displayName}</span>
            {user.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {user.tags.map((tag) => (
                  <TagBadge key={tag.type} tag={tag} />
                ))}
              </div>
            )}
          </div>

          <div className="text-right text-sm">
            <RankChangeBadge change={user.rankChange} />
          </div>

          <div className="text-right">
            <span className="font-semibold text-sm" style={{ color: "#1a1040" }}>
              {formatCredits(user.creditsUsed)}
            </span>
          </div>
        </div>
      ))}

      {users.length === 0 && (
        <div className="px-5 py-10 text-center" style={{ color: "#8a80a0" }}>
          No usage data for this week.
        </div>
      )}
    </div>
  );
}
