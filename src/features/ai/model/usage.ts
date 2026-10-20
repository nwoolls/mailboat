import type { PlanLimit, UsageTotals } from "../../../platform/tauri/bindings";

/** 950 → "950", 12_300 → "12.3k", 4_200_000 → "4.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** One provider's totals as a sentence. */
export function describeTotals(t: UsageTotals, onDevice: boolean): string {
  if (t.requests === 0) return "None";
  const parts = [`${t.requests} ${t.requests === 1 ? "request" : "requests"}`];
  if (t.failed > 0) parts[0] += ` (${t.failed} failed)`;
  if (!onDevice && t.inputTokens + t.outputTokens > 0)
    parts.push(`${formatTokens(t.inputTokens)} in, ${formatTokens(t.outputTokens)} out`);
  if (t.costUsd != null && t.costUsd > 0)
    parts.push(`≈ $${t.costUsd.toFixed(t.costUsd < 1 ? 3 : 2)}`);
  return parts.join(" · ");
}

const WINDOWS: Record<string, string> = {
  five_hour: "5-hour limit",
  seven_day: "weekly limit",
  seven_day_opus: "weekly Opus limit",
  seven_day_sonnet: "weekly Sonnet limit",
};

/** "67% of the 5-hour limit, resets 3:00 PM". */
export function describeLimit(limit: PlanLimit, now = new Date()): string {
  const name = WINDOWS[limit.window] ?? limit.window.replace(/_/g, " ") + " limit";
  let text = `${Math.round((limit.used ?? 0) * 100)}% of the ${name}`;
  if (limit.resetsAt) {
    const at = new Date(limit.resetsAt * 1000);
    const sameDay = at.toDateString() === now.toDateString();
    const when = sameDay
      ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : at.toLocaleDateString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
    text += `, resets ${when}`;
  }
  return text;
}

/** Local midnight today, in Unix ms (usage "today" counts from it). */
export function startOfToday(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}
