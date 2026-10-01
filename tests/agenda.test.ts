import { describe, expect, it } from "vitest";
import { buildAgenda, layoutLanes, type AgendaEventInput } from "@/lib/domain/agenda";
import { weekRangeFromStart } from "@/lib/domain/time";
import { task } from "./helpers";

const LA = "America/Los_Angeles";
const week = weekRangeFromStart("2026-09-28", LA); // Mon Sep 28 – Sun Oct 4
const today = "2026-09-30"; // Wed
const group = { slug: "applications", name: "Applications", color: "#3b82f6" };

function ev(over: Partial<AgendaEventInput> & Pick<AgendaEventInput, "start" | "end">): AgendaEventInput {
  return { id: over.title ?? "e", title: "Event", allDay: false, color: null, groupSlug: null, ...over };
}

const build = (events: AgendaEventInput[], tasks: ReturnType<typeof task>[] = []) =>
  buildAgenda({ days: week.days, today, tz: LA, events, tasks: tasks.map((t) => ({ task: t, group })) });

const day = (res: ReturnType<typeof build>, date: string) => res.find((d) => d.date === date)!.items;

describe("buildAgenda", () => {
  it("places timed events on their local start day", () => {
    // 6pm Wed in LA is already Thursday in UTC.
    const res = build([ev({ title: "Coffee chat", start: "2026-10-01T01:00:00Z", end: "2026-10-01T01:30:00Z" })]);
    expect(day(res, "2026-09-30").map((i) => i.kind === "event" && i.title)).toEqual(["Coffee chat"]);
    expect(day(res, "2026-10-01")).toEqual([]);
  });

  it("repeats multi-day all-day events on every day they cover, and no further", () => {
    // Google gives all-day events an exclusive end date: Thu–Fri.
    const res = build([ev({ title: "Offsite", allDay: true, start: "2026-10-01T07:00:00Z", end: "2026-10-03T07:00:00Z" })]);
    expect(res.filter((d) => d.items.length).map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("puts tasks on their due date and pulls overdue ones onto today", () => {
    const res = build([], [task({ content: "Due Fri", due: "2026-10-02" }), task({ content: "Late", due: "2026-09-21" })]);
    expect(day(res, "2026-10-02").map((i) => i.kind === "task" && i.content)).toEqual(["Due Fri"]);
    const late = day(res, today)[0];
    expect(late).toMatchObject({ kind: "task", content: "Late", overdue: true, dueDate: "2026-09-21", time: null });
  });

  it("uses the local date for timed tasks", () => {
    // 11pm Thu in LA = Fri 06:00 UTC.
    const res = build([], [task({ content: "Late-night apply", due: "2026-10-02T06:00:00Z" })]);
    expect(day(res, "2026-10-01")).toHaveLength(1);
    expect(day(res, "2026-10-02")).toHaveLength(0);
  });

  it("skips undated tasks and tasks outside the week", () => {
    const res = build([], [task({ due: undefined }), task({ due: "2026-10-12" })]);
    expect(res.every((d) => d.items.length === 0)).toBe(true);
  });

  it("doesn't pull overdue tasks into a week that doesn't contain today", () => {
    const next = weekRangeFromStart("2026-10-05", LA);
    const res = buildAgenda({ days: next.days, today, tz: LA, events: [], tasks: [{ task: task({ due: "2026-09-21" }), group }] });
    expect(res.every((d) => d.items.length === 0)).toBe(true);
  });

  it("sorts all-day events, then overdue and date-only tasks, then everything timed", () => {
    const res = build(
      [
        ev({ title: "Standup", start: "2026-09-30T16:00:00Z", end: "2026-09-30T16:15:00Z" }), // 9:00
        ev({ title: "Holiday", allDay: true, start: "2026-09-30T07:00:00Z", end: "2026-10-01T07:00:00Z" }),
      ],
      [
        task({ content: "Apply at 8:30", due: "2026-09-30T15:30:00Z" }),
        task({ content: "Today, no time", due: "2026-09-30" }),
        task({ content: "Overdue", due: "2026-09-29" }),
      ],
    );
    expect(day(res, today).map((i) => (i.kind === "event" ? i.title : i.content))).toEqual([
      "Holiday",
      "Overdue",
      "Today, no time",
      "Apply at 8:30",
      "Standup",
    ]);
  });

  it("gives timed items minutes since local midnight, splitting events that cross midnight", () => {
    // Wed 10pm → Thu 1am in LA.
    const res = build(
      [ev({ title: "Red-eye", start: "2026-10-01T05:00:00Z", end: "2026-10-01T08:00:00Z" })],
      [task({ content: "Apply 9:15", due: "2026-09-30T16:15:00Z", durationMinutes: 45 }), task({ content: "Call 2pm", due: "2026-09-30T21:00:00Z" })],
    );
    const wed = day(res, "2026-09-30");
    expect(wed.find((i) => i.kind === "event")).toMatchObject({ startMin: 22 * 60, endMin: 24 * 60 });
    expect(day(res, "2026-10-01")[0]).toMatchObject({ kind: "event", startMin: 0, endMin: 60 });
    expect(wed.find((i) => i.kind === "task" && i.content === "Apply 9:15")).toMatchObject({ startMin: 555, endMin: 600 });
    expect(wed.find((i) => i.kind === "task" && i.content === "Call 2pm")).toMatchObject({ startMin: 840, endMin: 870 }); // default 30 min
  });

  it("leaves all-day events and untimed or overdue tasks off the time axis", () => {
    const res = build(
      [ev({ title: "Holiday", allDay: true, start: "2026-09-30T07:00:00Z", end: "2026-10-01T07:00:00Z" })],
      [task({ due: "2026-09-30" }), task({ due: "2026-09-25T16:00:00Z" })],
    );
    expect(day(res, today).every((i) => i.startMin === null && i.endMin === null)).toBe(true);
  });
});

describe("layoutLanes", () => {
  const span = (id: string, startMin: number, endMin: number) => ({ id, startMin, endMin });
  const lanes = (items: ReturnType<typeof span>[], min = 0) =>
    Object.fromEntries(layoutLanes(items, min).map((p) => [p.item.id, `${p.lane}/${p.lanes}`]));

  it("keeps non-overlapping items full width", () => {
    expect(lanes([span("a", 540, 600), span("b", 600, 660)])).toEqual({ a: "0/1", b: "0/1" });
  });

  it("splits overlapping items and reuses freed lanes within a cluster", () => {
    // a 9–11, b 9:30–10, c 10–10:30 (fits under b), d 12–1 (new cluster)
    expect(lanes([span("a", 540, 660), span("b", 570, 600), span("c", 600, 630), span("d", 720, 780)])).toEqual({
      a: "0/2",
      b: "1/2",
      c: "1/2",
      d: "0/1",
    });
  });

  it("treats very short items as at least the minimum height when deciding overlaps", () => {
    expect(lanes([span("a", 540, 545), span("b", 550, 600)], 22)).toEqual({ a: "0/2", b: "1/2" });
  });

  it("ignores untimed items", () => {
    expect(layoutLanes([{ startMin: null, endMin: null }])).toEqual([]);
  });
});
