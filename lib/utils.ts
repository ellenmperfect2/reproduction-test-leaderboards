import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getCurrentWeekBounds(): { start: Date; end: Date } {
  const now = new Date();
  const daysFromMonday = (now.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMonday)
  );
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday, end: sunday };
}

export function getQ1Bounds(): { start: Date; end: Date } {
  const now = new Date();
  return { start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), end: now };
}

export function formatWeekLabel(start: Date, end: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[start.getUTCMonth()]} ${start.getUTCDate()} \u2013 ${months[end.getUTCMonth()]} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
}

export function formatCredits(n: number): string {
  return n.toLocaleString("en-US");
}
