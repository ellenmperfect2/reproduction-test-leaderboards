"use client";

import { useRouter } from "next/navigation";
import { toDateString } from "@/lib/utils";

interface DateRangePickerProps {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  weekLabel: string;
  isCurrentWeek: boolean;
}

export default function DateRangePicker({
  startDate,
  endDate,
  weekLabel,
  isCurrentWeek,
}: DateRangePickerProps) {
  const router = useRouter();

  function navigate(weeksOffset: number) {
    const start = new Date(startDate + "T00:00:00Z");
    const end = new Date(endDate + "T00:00:00Z");
    start.setUTCDate(start.getUTCDate() + weeksOffset * 7);
    end.setUTCDate(end.getUTCDate() + weeksOffset * 7);
    router.push(`/?start=${toDateString(start)}&end=${toDateString(end)}`);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => navigate(-1)}
        className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-[rgba(26,16,64,0.08)] text-[#1a1040] text-lg font-semibold"
        aria-label="Previous week"
      >
        ‹
      </button>

      <span
        className="px-4 py-1.5 rounded-full text-sm font-medium border"
        style={{
          background: "rgba(26,16,64,0.06)",
          borderColor: "rgba(26,16,64,0.12)",
          color: "#1a1040",
        }}
      >
        {weekLabel}
      </span>

      <button
        onClick={() => navigate(1)}
        disabled={isCurrentWeek}
        className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-[rgba(26,16,64,0.08)] text-[#1a1040] text-lg font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Next week"
      >
        ›
      </button>
    </div>
  );
}
