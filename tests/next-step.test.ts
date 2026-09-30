import { describe, expect, it } from "vitest";
import { countTasks, isOverdue, pickNextStep, rankNextSteps, sortTaskTree, type NextStepContext } from "@/lib/domain/next-step";
import { task } from "./helpers";

const ctx: NextStepContext = { today: "2026-10-07", now: new Date("2026-10-07T17:00:00Z") }; // 10:00 in LA

describe("next-step ranking", () => {
  it("puts the `next` label first, regardless of anything else", () => {
    const overdueP1 = task({ due: "2026-10-01", priority: 4 });
    const labelled = task({ labels: ["next"] });
    expect(pickNextStep([overdueP1, labelled], ctx)?.id).toBe(labelled.id);
  });

  it("breaks ties between `next` tasks by Todoist order", () => {
    const a = task({ labels: ["next"], childOrder: 5 });
    const b = task({ labels: ["next"], childOrder: 2 });
    expect(rankNextSteps([a, b], ctx).map((t) => t.id)).toEqual([b.id, a.id]);
  });

  it("then overdue tasks, oldest first", () => {
    const newer = task({ due: "2026-10-05" });
    const older = task({ due: "2026-09-30" });
    const today = task({ due: "2026-10-07", priority: 4 });
    expect(rankNextSteps([newer, today, older], ctx).map((t) => t.id)).toEqual([older.id, newer.id, today.id]);
  });

  it("treats a timed task earlier today as overdue", () => {
    const pastTime = task({ due: "2026-10-07T15:00:00Z" }); // 8:00 LA
    const laterToday = task({ due: "2026-10-07T22:00:00Z" });
    expect(isOverdue(pastTime, ctx)).toBe(true);
    expect(isOverdue(laterToday, ctx)).toBe(false);
    expect(pickNextStep([laterToday, pastTime], ctx)?.id).toBe(pastTime.id);
  });

  it("then due today, then priority p1→p4", () => {
    const todayP4 = task({ due: "2026-10-07", priority: 1 });
    const tomorrowP1 = task({ due: "2026-10-08", priority: 4 });
    const undatedP2 = task({ priority: 3 });
    expect(rankNextSteps([undatedP2, tomorrowP1, todayP4], ctx).map((t) => t.id)).toEqual([todayP4.id, tomorrowP1.id, undatedP2.id]);
  });

  it("then due date ascending with undated last, then Todoist order", () => {
    const later = task({ due: "2026-10-20" });
    const sooner = task({ due: "2026-10-10" });
    const undatedA = task({ childOrder: 50 });
    const undatedB = task({ childOrder: 10 });
    expect(rankNextSteps([undatedA, later, undatedB, sooner], ctx).map((t) => t.id)).toEqual([sooner.id, later.id, undatedB.id, undatedA.id]);
  });

  it("excludes subtasks, completed tasks and tasks skipped for today", () => {
    const parent = task();
    const child = task({ parentId: parent.id, priority: 4 });
    const done = task({ checked: true, priority: 4 });
    const skipped = task({ labels: ["skip:2026-10-07"], priority: 4 });
    const skippedYesterday = task({ labels: ["skip:2026-10-06"], priority: 2 });
    const ranked = rankNextSteps([parent, child, done, skipped, skippedYesterday], ctx).map((t) => t.id);
    expect(ranked).toEqual([skippedYesterday.id, parent.id]);
  });

  it("returns null for an empty group", () => {
    expect(pickNextStep([], ctx)).toBeNull();
  });

  it("builds a tree with children in Todoist order and skipped tasks last", () => {
    const skipped = task({ labels: ["skip:2026-10-07"], priority: 4 });
    const root = task();
    const c2 = task({ parentId: root.id, childOrder: 2 });
    const c1 = task({ parentId: root.id, childOrder: 1 });
    const tree = sortTaskTree([skipped, c2, root, c1], ctx);
    expect(tree.map((t) => t.id)).toEqual([root.id, skipped.id]);
    expect(tree[0].children.map((t) => t.id)).toEqual([c1.id, c2.id]);
  });

  it("counts overdue and due-today separately", () => {
    const counts = countTasks([task({ due: "2026-10-01" }), task({ due: "2026-10-07" }), task()], ctx);
    expect(counts).toEqual({ open: 3, overdue: 1, dueToday: 1 });
  });
});
