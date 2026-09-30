import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelAction,
  confirmAction,
  isAffirmative,
  isNegative,
  PENDING_TTL_MS,
  propose,
  retryRemaining,
  runSteps,
  toView,
  undoAction,
  type ActionStep,
  type ConfirmDeps,
  type PendingRecord,
  type PendingRepo,
} from "@/lib/ai/pending-actions";

/** In-memory repo with the same conditional-update semantics as the Postgres one. */
function memoryRepo() {
  const rows = new Map<string, PendingRecord>();
  let n = 0;
  const repo: PendingRepo = {
    async create({ userId, chatSessionId, turnId, steps, expiresAt }) {
      const row: PendingRecord = { id: `pa${++n}`, userId, chatSessionId, turnId, status: "awaiting_confirmation", steps, result: null, error: null, undone: false, expiresAt };
      rows.set(row.id, row);
      return { ...row };
    },
    async get(id, userId) {
      const r = rows.get(id);
      return r && r.userId === userId ? { ...r } : null;
    },
    async append(id, userId, steps, expiresAt) {
      const r = rows.get(id);
      if (!r || r.userId !== userId || r.status !== "awaiting_confirmation") return null;
      r.steps = [...r.steps, ...steps];
      r.expiresAt = expiresAt;
      return { ...r };
    },
    async claim(id, userId, now) {
      const r = rows.get(id);
      if (!r || r.userId !== userId || r.status !== "awaiting_confirmation" || r.expiresAt <= now) return null;
      r.status = "executing";
      return { ...r };
    },
    async transition(id, userId, from, patch) {
      const r = rows.get(id);
      if (!r || r.userId !== userId || r.status !== from) return false;
      Object.assign(r, { ...patch, executedAt: undefined });
      return true;
    },
    async markUndone(id, userId) {
      const r = rows.get(id);
      if (!r || r.userId !== userId || r.undone) return false;
      r.undone = true;
      return true;
    },
  };
  return { repo, rows };
}

const step = (tool: string, summary = tool): ActionStep => ({ tool, summary, params: {} });
const USER = "u1";

describe("pending-action state machine", () => {
  let clock: Date;
  let mem: ReturnType<typeof memoryRepo>;
  let runStep: ConfirmDeps["runStep"];
  let revalidate: ConfirmDeps["revalidate"];
  const deps = (): ConfirmDeps => ({ repo: mem.repo, now: () => clock, revalidate, runStep });

  beforeEach(() => {
    clock = new Date("2026-10-07T17:00:00Z");
    mem = memoryRepo();
    runStep = vi.fn(async (s: ActionStep) => ({ undo: [{ kind: "undo", step: s.tool }] }));
    revalidate = vi.fn(async () => null);
  });

  const proposeSteps = (steps: ActionStep[], existingId?: string) =>
    propose(mem.repo, () => clock, { userId: USER, chatSessionId: "c1", turnId: "t1", existingId, steps });

  it("stores proposals as awaiting with a 10-minute expiry and nothing executed", async () => {
    const row = await proposeSteps([step("create_task")]);
    expect(row.status).toBe("awaiting_confirmation");
    expect(row.expiresAt.getTime() - clock.getTime()).toBe(PENDING_TTL_MS);
    expect(runStep).not.toHaveBeenCalled();
  });

  it("appends later writes from the same turn into one compound proposal", async () => {
    const first = await proposeSteps([step("upsert_application")]);
    const second = await proposeSteps([step("create_task")], first.id);
    expect(second.id).toBe(first.id);
    expect(second.steps.map((s) => s.tool)).toEqual(["upsert_application", "create_task"]);
  });

  it("executes all steps in order on confirm, exactly once", async () => {
    const row = await proposeSteps([step("a"), step("b"), step("c")]);
    const res = await confirmAction(deps(), row.id, USER);
    expect(res.outcome).toBe("executed");
    expect(vi.mocked(runStep).mock.calls.map(([s]) => s.tool)).toEqual(["a", "b", "c"]);
    expect(mem.rows.get(row.id)!.status).toBe("executed");

    const again = await confirmAction(deps(), row.id, USER);
    expect(again).toMatchObject({ outcome: "rejected", status: "executed" });
    expect(runStep).toHaveBeenCalledTimes(3);
  });

  it("lets only one of two concurrent confirms run", async () => {
    const row = await proposeSteps([step("a")]);
    const [r1, r2] = await Promise.all([confirmAction(deps(), row.id, USER), confirmAction(deps(), row.id, USER)]);
    expect([r1.outcome, r2.outcome].sort()).toEqual(["executed", "rejected"]);
    expect(runStep).toHaveBeenCalledTimes(1);
  });

  it("rejects other users, unknown ids and expired rows (marking them expired)", async () => {
    const row = await proposeSteps([step("a")]);
    expect(await confirmAction(deps(), row.id, "intruder")).toMatchObject({ outcome: "rejected", status: "not_found" });
    expect(await confirmAction(deps(), "nope", USER)).toMatchObject({ outcome: "rejected", status: "not_found" });

    clock = new Date(clock.getTime() + PENDING_TTL_MS + 1);
    expect(await confirmAction(deps(), row.id, USER)).toMatchObject({ outcome: "rejected", status: "expired" });
    expect(mem.rows.get(row.id)!.status).toBe("expired");
    expect(runStep).not.toHaveBeenCalled();
  });

  it("re-validates at confirm and fails stale proposals without running anything", async () => {
    revalidate = vi.fn(async () => "“Email Ramp recruiter” was completed on another device");
    const row = await proposeSteps([step("reschedule_task")]);
    const res = await confirmAction(deps(), row.id, USER);
    expect(res).toMatchObject({ outcome: "stale", reason: expect.stringContaining("completed") });
    expect(runStep).not.toHaveBeenCalled();
    expect(mem.rows.get(row.id)!.status).toBe("failed");
    expect(toView(mem.rows.get(row.id)!).stale).toBe(true);
    // A stale proposal can't be retried as-is; the assistant proposes a new one.
    expect(await retryRemaining(mem.repo, () => clock, row.id, USER)).toMatchObject({ ok: false });
  });

  it("stops at the first failing step and records which steps succeeded", async () => {
    runStep = vi.fn(async (s: ActionStep) => {
      if (s.tool === "b") throw new Error("Todoist returned 404");
      return { undo: [{ kind: "undo", step: s.tool }] };
    });
    const row = await proposeSteps([step("a"), step("b"), step("c")]);
    const res = await confirmAction(deps(), row.id, USER);
    expect(res.outcome).toBe("failed");
    const saved = mem.rows.get(row.id)!;
    expect(saved.status).toBe("failed");
    expect(saved.result!.failedIndex).toBe(1);
    expect(saved.result!.steps.map((s) => [s.tool, s.ok])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(vi.mocked(runStep).mock.calls.map(([s]) => s.tool)).toEqual(["a", "b"]);
  });

  it("retries only the remaining steps as a new proposal", async () => {
    runStep = vi.fn(async (s: ActionStep) => {
      if (s.tool === "b") throw new Error("rate limited");
      return {};
    });
    const row = await proposeSteps([step("a"), step("b"), step("c")]);
    await confirmAction(deps(), row.id, USER);
    const retry = await retryRemaining(mem.repo, () => clock, row.id, USER);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.record.id).not.toBe(row.id);
    expect(retry.record.status).toBe("awaiting_confirmation");
    expect(retry.record.steps.map((s) => s.tool)).toEqual(["b", "c"]);
  });

  it("undoes completed steps in reverse order, once", async () => {
    const undone: string[] = [];
    const row = await proposeSteps([step("a"), step("b")]);
    await confirmAction(deps(), row.id, USER);
    const res = await undoAction({ repo: mem.repo, runUndo: async (op) => void undone.push(String(op.step)) }, row.id, USER);
    expect(res).toMatchObject({ ok: true, undoneSteps: 2, errors: [] });
    expect(undone).toEqual(["b", "a"]);
    expect(await undoAction({ repo: mem.repo, runUndo: async () => {} }, row.id, USER)).toMatchObject({ ok: false });
  });

  it("can't undo something that never ran", async () => {
    const row = await proposeSteps([step("a")]);
    expect(await undoAction({ repo: mem.repo, runUndo: async () => {} }, row.id, USER)).toMatchObject({ ok: false });
  });

  it("cancels only while awaiting", async () => {
    const row = await proposeSteps([step("a")]);
    expect(await cancelAction(mem.repo, row.id, USER)).toEqual({ ok: true });
    expect(await cancelAction(mem.repo, row.id, USER)).toMatchObject({ ok: false });
    expect(await confirmAction(deps(), row.id, USER)).toMatchObject({ outcome: "rejected", status: "cancelled" });
  });

  it("runSteps catches thrown errors into the result", async () => {
    const res = await runSteps([step("x")], async () => {
      throw new Error("boom");
    });
    expect(res).toMatchObject({ failedIndex: 0, error: "boom" });
  });
});

describe("chat confirmations", () => {
  it.each(["yes", "Yes!", "yep", "go ahead", "Do it", "ok", "sure, go ahead", "yes please", "sounds good", "confirm"])("treats %j as a confirmation", (t) => {
    expect(isAffirmative(t)).toBe(true);
  });

  it.each(["yes but change the date to Friday", "no", "maybe", "what would that do?", "", "yes and also add another task for tomorrow afternoon"])(
    "does not treat %j as a confirmation",
    (t) => {
      expect(isAffirmative(t)).toBe(false);
    },
  );

  it("detects cancellations", () => {
    expect(isNegative("No, cancel that")).toBe(true);
    expect(isNegative("never mind")).toBe(true);
    expect(isNegative("yes")).toBe(false);
  });
});
