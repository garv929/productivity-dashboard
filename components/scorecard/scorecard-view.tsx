"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { ScorecardData } from "@/lib/services/dashboard";
import type { ScoreRow } from "@/lib/domain/scorecard";
import { clearWeekOverridesAction, saveTargetsAction, saveWeeklyReviewAction } from "@/app/actions/records";
import { unwrap } from "@/lib/client/fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Field, useAction } from "@/components/panels/shared";
import { cn } from "@/lib/utils";

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shiftWeek(weekStart: string, weeks: number) {
  return addDays(weekStart, weeks * 7);
}

function weekLabel(start: string, end: string) {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${f(start)} – ${f(end)}`;
}

function targetText(r: Pick<ScoreRow, "min" | "max" | "isCap">) {
  if (r.isCap) return r.max !== null ? `≤ ${r.max}` : "—";
  if (r.min !== null && r.max !== null && r.min !== r.max) return `${r.min}–${r.max}`;
  return r.min !== null ? String(r.min) : r.max !== null ? `≤ ${r.max}` : "—";
}

export function ScorecardView({ data, hasOverrides }: { data: ScorecardData; hasOverrides: boolean }) {
  const d = data;
  const hrefFor = (kind: ScoreRow["groupKind"]) => {
    const g = d.chartGroups.find((x) => x.kind === kind);
    return g ? `/g/${g.slug}` : null;
  };
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{d.isCurrentWeek ? "This week" : "Past week"}</p>
          <h1 className="mt-1 text-3xl">Weekly scorecard</h1>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" asChild aria-label="Previous week">
            <Link href={`/scorecard?week=${shiftWeek(d.weekStart, -1)}`}><ChevronLeft /></Link>
          </Button>
          <span className="min-w-36 text-center text-sm">{weekLabel(d.weekStart, d.weekEnd)}</span>
          <Button variant="ghost" size="icon-sm" asChild aria-label="Next week" disabled={d.isCurrentWeek}>
            <Link href={d.isCurrentWeek ? "#" : `/scorecard?week=${shiftWeek(d.weekStart, 1)}`} aria-disabled={d.isCurrentWeek} className={cn(d.isCurrentWeek && "pointer-events-none opacity-40")}>
              <ChevronRight />
            </Link>
          </Button>
          {!d.isCurrentWeek && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/scorecard">This week</Link>
            </Button>
          )}
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-xl">Targets vs. actuals</h2>
          <div className="ml-auto flex gap-2">
            {hasOverrides && <ClearOverrides weekStart={d.weekStart} />}
            <AdjustTargets weekStart={d.weekStart} rows={d.rows} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {d.rows.map((r) => (
            <MetricCard key={r.metric} row={r} href={hrefFor(r.groupKind)} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl">Completed to-dos by day</h2>
        <div className="h-72 rounded-xl border bg-card p-3">
          {d.chartGroups.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No groups yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.chart} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--popover-foreground)" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {d.chartGroups.map((g, i) => (
                  <Bar key={g.id} dataKey={g.slug} name={g.name} stackId="done" fill={g.color} radius={i === d.chartGroups.length - 1 ? [4, 4, 0, 0] : 0} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <ReviewForm key={d.weekStart} weekStart={d.weekStart} review={d.review} />

      <section>
        <h2 className="mb-3 text-xl">Previous weeks</h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Week</th>
                {d.rows.map((r) => (
                  <th key={r.metric} className="px-3 py-2 font-medium">{r.label}</th>
                ))}
                <th className="px-3 py-2 font-medium">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.history.map((h) => (
                <tr key={h.weekStart}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link className="hover:underline" href={`/scorecard?week=${h.weekStart}`}>
                      {weekLabel(h.weekStart, addDays(h.weekStart, 6))}
                    </Link>
                  </td>
                  {h.rows.map((r) => (
                    <td key={r.metric} className={cn("px-3 py-2", r.status === "behind" && "text-muted-foreground", r.status === "over" && "text-destructive", r.status === "met" && "text-success")}>
                      {r.actual}
                      <span className="text-muted-foreground"> / {targetText(r)}</span>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-muted-foreground">{h.review ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ row: r, href }: { row: ScoreRow; href: string | null }) {
  const denom = r.isCap ? r.max : (r.min ?? r.max);
  const pct = denom ? Math.min(100, Math.round((r.actual / denom) * 100)) : 0;
  const tone = r.status === "met" ? "text-success" : r.status === "over" ? "text-destructive" : "text-foreground";
  const statusText = r.isCap
    ? r.status === "over" ? "Over cap" : "Within cap"
    : r.status === "met" ? "Met" : r.status === "over" ? "Above range" : "Behind";
  const className = "group block rounded-xl border bg-card p-4 transition-colors hover:border-primary/40";
  const body = (
    <>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{r.label}</span>
        <span className={cn(r.status === "met" && "text-success", r.status === "over" && "text-destructive", r.status === "behind" && "text-primary")}>{statusText}</span>
      </div>
      <p className="mt-2 font-serif text-3xl">
        <span className={tone}>{r.actual}</span>
        <span className="text-lg text-muted-foreground"> / {targetText(r)}{r.unit === "hours" ? "h" : ""}</span>
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", r.status === "over" ? "bg-destructive" : r.status === "met" ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </>
  );
  return href ? (
    <Link href={href} className={className}>{body}</Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function AdjustTargets({ weekStart, rows }: { weekStart: string; rows: ScoreRow[] }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(() => rows.map((r) => ({ metric: r.metric, label: r.label, isCap: r.isCap, min: r.min?.toString() ?? "", max: r.max?.toString() ?? "" })));
  const { run, pending } = useAction();
  const toNum = (s: string) => (s.trim() === "" ? null : Number(s));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm"><SlidersHorizontal /> Adjust this week</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              try {
                unwrap(await saveTargetsAction(weekStart, values.map((v) => ({ metric: v.metric, min: toNum(v.min), max: toNum(v.max) }))));
                toast.success("Targets for this week updated");
                setOpen(false);
              } catch {}
            });
          }}
        >
          <p className="font-serif">Targets for this week only</p>
          <p className="text-xs text-muted-foreground">Defaults live in Settings. Leave a field blank for no bound.</p>
          {values.map((v, i) => (
            <div key={v.metric} className="grid grid-cols-[1fr_4rem_4rem] items-center gap-2">
              <span className="text-sm">{v.label}</span>
              <Input
                aria-label={`${v.label} min`}
                placeholder="min"
                type="number"
                step="0.5"
                min="0"
                disabled={v.isCap}
                value={v.min}
                onChange={(e) => setValues((vs) => vs.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))}
              />
              <Input
                aria-label={`${v.label} max`}
                placeholder={v.isCap ? "cap" : "max"}
                type="number"
                step="0.5"
                min="0"
                value={v.max}
                onChange={(e) => setValues((vs) => vs.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))}
              />
            </div>
          ))}
          <Button type="submit" size="sm" className="w-full" disabled={pending}>Save for this week</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function ClearOverrides({ weekStart }: { weekStart: string }) {
  const { run, pending } = useAction();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        run(async () => {
          try {
            unwrap(await clearWeekOverridesAction(weekStart));
            toast.success("Back to default targets");
          } catch {}
        })
      }
    >
      <RotateCcw /> Use defaults
    </Button>
  );
}

function ReviewForm({ weekStart, review }: { weekStart: string; review: ScorecardData["review"] }) {
  const [rating, setRating] = useState<number | null>(review?.demandRating ?? null);
  const [routines, setRoutines] = useState<"yes" | "partly" | "no" | null>((review?.routines as "yes" | "partly" | "no" | null) ?? null);
  const { run, pending } = useAction();
  return (
    <section id="review">
      <h2 className="mb-1 text-xl">Weekly review</h2>
      <p className="mb-3 text-sm text-muted-foreground">Ten minutes on Sunday. Be honest; nobody else reads this.</p>
      <form
        className="space-y-4 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const s = (k: string) => (f.get(k) as string) || undefined;
          run(async () => {
            try {
              unwrap(
                await saveWeeklyReviewAction(weekStart, {
                  accomplished: s("accomplished"),
                  productive: s("productive"),
                  notProductive: s("notProductive"),
                  demandRating: rating,
                  routines,
                  changes: s("changes"),
                }),
              );
              toast.success("Review saved");
            } catch {}
          });
        }}
      >
        <Field label="What did I actually accomplish?">
          <Textarea name="accomplished" rows={3} defaultValue={review?.accomplished ?? ""} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What felt productive?">
            <Textarea name="productive" rows={3} defaultValue={review?.productive ?? ""} />
          </Field>
          <Field label="What felt busy but not productive?">
            <Textarea name="notProductive" rows={3} defaultValue={review?.notProductive ?? ""} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="How demanding did this week feel? (1–5)">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setRating(rating === n ? null : n)}
                  className={cn("size-9 rounded-lg border text-sm", rating === n ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Did I keep my routines?">
            <div className="flex gap-1">
              {(["yes", "partly", "no"] as const).map((v) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => setRoutines(routines === v ? null : v)}
                  className={cn("rounded-lg border px-3 py-1.5 text-sm capitalize", routines === v ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
                >
                  {v}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <Field label="What should change next week?">
          <Textarea name="changes" rows={3} defaultValue={review?.changes ?? ""} />
        </Field>
        <Button type="submit" disabled={pending}>Save review</Button>
      </form>
    </section>
  );
}
