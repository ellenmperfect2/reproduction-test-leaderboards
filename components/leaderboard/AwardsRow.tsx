import type { Awards } from "@/types/leaderboard";

interface AwardsRowProps {
  awards: Awards;
}

const cardStyles = {
  king: {
    background: "linear-gradient(135deg, rgba(212,175,55,0.18), rgba(240,210,80,0.1))",
    borderColor: "rgba(212,175,55,0.35)",
    iconBg: "rgba(212,175,55,0.2)",
    titleColor: "#9a7a08",
  },
  mover: {
    background: "linear-gradient(135deg, rgba(37,99,168,0.14), rgba(64,128,210,0.08))",
    borderColor: "rgba(37,99,168,0.3)",
    iconBg: "rgba(37,99,168,0.12)",
    titleColor: "#2563a8",
  },
  battle: {
    background: "linear-gradient(135deg, rgba(192,57,43,0.12), rgba(220,80,60,0.07))",
    borderColor: "rgba(192,57,43,0.28)",
    iconBg: "rgba(192,57,43,0.12)",
    titleColor: "#c0392b",
  },
};

interface AwardCardProps {
  variant: keyof typeof cardStyles;
  icon: string;
  title: string;
  winner: string | null;
  description: string | null;
}

function AwardCard({ variant, icon, title, winner, description }: AwardCardProps) {
  const style = cardStyles[variant];

  return (
    <div
      className="flex-1 rounded-xl p-5 border"
      style={{ background: style.background, borderColor: style.borderColor }}
    >
      <div className="flex items-center gap-3 mb-3">
        <span
          className="w-9 h-9 flex items-center justify-center rounded-lg text-lg"
          style={{ background: style.iconBg }}
        >
          {icon}
        </span>
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: style.titleColor }}>
          {title}
        </span>
      </div>
      {winner ? (
        <>
          <p className="font-playfair font-semibold text-[#1a1040] text-lg leading-snug">{winner}</p>
          <p className="text-sm mt-0.5" style={{ color: "#5a5070" }}>{description}</p>
        </>
      ) : (
        <p className="text-sm" style={{ color: "#8a80a0" }}>Not enough data yet</p>
      )}
    </div>
  );
}

export default function AwardsRow({ awards }: AwardsRowProps) {
  return (
    <div className="flex gap-4 flex-col sm:flex-row">
      <AwardCard
        variant="king"
        icon="👑"
        title="King of the Hill"
        winner={awards.kingOfTheHill?.winner ?? null}
        description={awards.kingOfTheHill?.description ?? null}
      />
      <AwardCard
        variant="mover"
        icon="🚀"
        title="Mover &amp; Shaker"
        winner={awards.moverAndShaker?.winner ?? null}
        description={awards.moverAndShaker?.description ?? null}
      />
      <AwardCard
        variant="battle"
        icon="⚔️"
        title="Battle Royale"
        winner={awards.battleRoyale?.winner ?? null}
        description={awards.battleRoyale?.description ?? null}
      />
    </div>
  );
}
