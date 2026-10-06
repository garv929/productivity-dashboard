import type { ActivityType } from "@/lib/db/schema";

export type MetricKey =
  | "applications"
  | "outreach"
  | "follow_ups"
  | "prep_sessions"
  | "conversations"
  | "side_income_hours";

export type MetricDef = {
  key: MetricKey;
  label: string;
  activity: ActivityType;
  unit: "count" | "hours";
  defaultMin: number | null;
  defaultMax: number | null;
  /** Cap metrics are "good" while at or below max (side-income hours). */
  isCap?: boolean;
  groupKind: "pipeline" | "people" | "prep" | "options";
};

export const DEFAULT_SIDE_INCOME_CAP = 4.5;

export const METRICS: MetricDef[] = [
  { key: "applications", label: "Applications", activity: "application", unit: "count", defaultMin: 8, defaultMax: null, groupKind: "pipeline" },
  { key: "outreach", label: "Outreach messages", activity: "outreach", unit: "count", defaultMin: 10, defaultMax: null, groupKind: "people" },
  { key: "follow_ups", label: "Follow-ups", activity: "follow_up", unit: "count", defaultMin: 3, defaultMax: 5, groupKind: "people" },
  { key: "prep_sessions", label: "Interview-prep sessions", activity: "prep_session", unit: "count", defaultMin: 2, defaultMax: null, groupKind: "prep" },
  { key: "conversations", label: "Real conversations", activity: "conversation", unit: "count", defaultMin: 1, defaultMax: 2, groupKind: "people" },
  { key: "side_income_hours", label: "Side-income hours", activity: "side_income_hours", unit: "hours", defaultMin: null, defaultMax: DEFAULT_SIDE_INCOME_CAP, isCap: true, groupKind: "options" },
];

export type TargetRow = { weekStart: string | null; metric: string; min: number | null; max: number | null };

export type ResolvedTarget = { min: number | null; max: number | null; overridden: boolean };

/** Per-week override (week_start = this week) beats the default (week_start null) beats built-ins. */
export function resolveTargets(rows: TargetRow[], weekStart: string): Record<MetricKey, ResolvedTarget> {
  const out = {} as Record<MetricKey, ResolvedTarget>;
  for (const m of METRICS) {
    const override = rows.find((r) => r.metric === m.key && r.weekStart === weekStart);
    const def = rows.find((r) => r.metric === m.key && r.weekStart === null);
    const src = override ?? def;
    out[m.key] = src
      ? { min: src.min, max: src.max, overridden: Boolean(override) }
      : { min: m.defaultMin, max: m.defaultMax, overridden: false };
  }
  return out;
}

export type ActivityPoint = { type: ActivityType; value: number };

export type ScoreRow = {
  metric: MetricKey;
  label: string;
  unit: MetricDef["unit"];
  actual: number;
  min: number | null;
  max: number | null;
  isCap: boolean;
  status: "met" | "behind" | "over" | "ok";
  /** 0..1 shortfall relative to the minimum target (0 when met). */
  gap: number;
  groupKind: MetricDef["groupKind"];
};

export function computeScorecard(activities: ActivityPoint[], targets: Record<MetricKey, ResolvedTarget>): ScoreRow[] {
  return METRICS.map((m) => {
    const actual = round1(activities.filter((a) => a.type === m.activity).reduce((s, a) => s + Number(a.value), 0));
    const { min, max } = targets[m.key];
    let status: ScoreRow["status"];
    if (m.isCap) status = max !== null && actual > max ? "over" : "ok";
    else if (min !== null && actual < min) status = "behind";
    else if (max !== null && actual > max) status = "over";
    else status = "met";
    const gap = !m.isCap && min && actual < min ? (min - actual) / min : 0;
    return { metric: m.key, label: m.label, unit: m.unit, actual, min, max, isCap: Boolean(m.isCap), status, gap, groupKind: m.groupKind };
  });
}

export function biggestGap(rows: ScoreRow[]): ScoreRow | null {
  const behind = rows.filter((r) => r.status === "behind").sort((a, b) => b.gap - a.gap);
  return behind[0] ?? null;
}

export function formatTarget(min: number | null, max: number | null, isCap = false): string {
  if (isCap) return max !== null ? `≤ ${max}` : "—";
  if (min !== null && max !== null && min !== max) return `${min}–${max}`;
  if (min !== null) return String(min);
  if (max !== null) return `≤ ${max}`;
  return "—";
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
