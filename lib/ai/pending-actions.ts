/**
 * Pending-action state machine for assistant writes. Pure: persistence and step
 * execution are injected so the transitions can be unit-tested without a database.
 *
 *   awaiting_confirmation ──claim──▶ executing ──▶ executed | failed
 *            │                                   (stale re-validation → failed)
 *            ├──cancel──▶ cancelled
 *            └──ttl────▶ expired
 *
 * A row is claimed with a conditional update, so it can never run twice.
 */
import type { PendingActionView, PendingStatus, StepPreview, StepResultView } from "./types";

export const PENDING_TTL_MS = 10 * 60_000;

export type UndoOp = { kind: string } & Record<string, unknown>;

export type ActionStep = {
  tool: string;
  summary: string;
  params: Record<string, unknown>;
  /** Snapshot of the entity at proposal time; compared again at confirm to detect drift. */
  fingerprint?: string | null;
};

export type StepOutcome = { summary?: string; undo?: UndoOp[] };

export type StepRecord = {
  index: number;
  tool: string;
  ok: boolean;
  summary: string;
  error?: string;
  undo: UndoOp[];
};

export type ExecutionResult = {
  steps: StepRecord[];
  failedIndex: number | null;
  error: string | null;
  stale?: boolean;
};

export type PendingRecord = {
  id: string;
  userId: string;
  chatSessionId: string | null;
  turnId: string | null;
  status: PendingStatus;
  steps: ActionStep[];
  result: ExecutionResult | null;
  error: string | null;
  undone: boolean;
  expiresAt: Date;
};

export type PendingPatch = Partial<Pick<PendingRecord, "status" | "result" | "error" | "undone">> & { executedAt?: Date };

export interface PendingRepo {
  create(input: { userId: string; chatSessionId: string | null; turnId: string | null; steps: ActionStep[]; expiresAt: Date }): Promise<PendingRecord>;
  get(id: string, userId: string): Promise<PendingRecord | null>;
  /** Appends steps to a still-awaiting row and extends its expiry. Returns null if it's no longer awaiting. */
  append(id: string, userId: string, steps: ActionStep[], expiresAt: Date): Promise<PendingRecord | null>;
  /** Atomic awaiting→executing for an unexpired row; null if someone else got there first. */
  claim(id: string, userId: string, now: Date): Promise<PendingRecord | null>;
  /** Conditional update: only applies when the current status equals `from`. */
  transition(id: string, userId: string, from: PendingStatus, patch: PendingPatch): Promise<boolean>;
  /** Atomic undone=false→true; false if already undone. */
  markUndone(id: string, userId: string): Promise<boolean>;
}

export type Clock = () => Date;

/* ------------------------------------------------------------- Execution */

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}

/** Runs steps in order and stops at the first failure. */
export async function runSteps(
  steps: ActionStep[],
  runStep: (step: ActionStep, index: number) => Promise<StepOutcome>,
): Promise<ExecutionResult> {
  const records: StepRecord[] = [];
  for (const [index, step] of steps.entries()) {
    try {
      const out = await runStep(step, index);
      records.push({ index, tool: step.tool, ok: true, summary: out.summary ?? step.summary, undo: out.undo ?? [] });
    } catch (err) {
      const error = errorText(err);
      records.push({ index, tool: step.tool, ok: false, summary: step.summary, error, undo: [] });
      return { steps: records, failedIndex: index, error };
    }
  }
  return { steps: records, failedIndex: null, error: null };
}

/* ------------------------------------------------------------- Proposal */

export async function propose(
  repo: PendingRepo,
  now: Clock,
  input: { userId: string; chatSessionId: string | null; turnId: string | null; existingId?: string | null; steps: ActionStep[] },
): Promise<PendingRecord> {
  if (input.steps.length === 0) throw new Error("Nothing to propose.");
  const expiresAt = new Date(now().getTime() + PENDING_TTL_MS);
  if (input.existingId) {
    const appended = await repo.append(input.existingId, input.userId, input.steps, expiresAt);
    if (appended) return appended;
  }
  return repo.create({ userId: input.userId, chatSessionId: input.chatSessionId, turnId: input.turnId, steps: input.steps, expiresAt });
}

/* ------------------------------------------------------------ Confirmation */

export type ConfirmDeps = {
  repo: PendingRepo;
  now: Clock;
  /** Re-checks every referenced entity; returns a human reason when something changed. */
  revalidate: (steps: ActionStep[]) => Promise<string | null>;
  runStep: (step: ActionStep, index: number) => Promise<StepOutcome>;
};

export type ConfirmOutcome =
  | { outcome: "executed"; record: PendingRecord }
  | { outcome: "failed"; record: PendingRecord }
  | { outcome: "stale"; reason: string; record: PendingRecord }
  | { outcome: "rejected"; reason: string; status: PendingStatus | "not_found" };

const REJECT_REASON: Record<PendingStatus, string> = {
  awaiting_confirmation: "This action is still waiting for confirmation.",
  executing: "This action is already running.",
  executed: "This action was already carried out, so it won't run again.",
  failed: "This action already ran and failed. Use Retry for the remaining steps.",
  cancelled: "This action was cancelled.",
  expired: "This proposal expired (they last 10 minutes). Ask the assistant to propose it again.",
};

export async function confirmAction(deps: ConfirmDeps, id: string, userId: string): Promise<ConfirmOutcome> {
  const { repo } = deps;
  const now = deps.now();
  const row = await repo.get(id, userId);
  if (!row) return { outcome: "rejected", reason: "That action doesn't exist.", status: "not_found" };
  if (row.status !== "awaiting_confirmation") return { outcome: "rejected", reason: REJECT_REASON[row.status], status: row.status };
  if (row.expiresAt.getTime() <= now.getTime()) {
    await repo.transition(id, userId, "awaiting_confirmation", { status: "expired" });
    return { outcome: "rejected", reason: REJECT_REASON.expired, status: "expired" };
  }

  const claimed = await repo.claim(id, userId, now);
  if (!claimed) {
    const fresh = await repo.get(id, userId);
    const status = fresh?.status ?? "not_found";
    return { outcome: "rejected", reason: status === "not_found" ? "That action doesn't exist." : REJECT_REASON[status], status };
  }

  let staleReason: string | null;
  try {
    staleReason = await deps.revalidate(claimed.steps);
  } catch (err) {
    staleReason = errorText(err);
  }
  if (staleReason) {
    const result: ExecutionResult = { steps: [], failedIndex: 0, error: staleReason, stale: true };
    await repo.transition(id, userId, "executing", { status: "failed", result, error: `Changed since proposal: ${staleReason}`, executedAt: deps.now() });
    return { outcome: "stale", reason: staleReason, record: { ...claimed, status: "failed", result, error: staleReason } };
  }

  const result = await runSteps(claimed.steps, deps.runStep);
  const status: PendingStatus = result.failedIndex === null ? "executed" : "failed";
  await repo.transition(id, userId, "executing", { status, result, error: result.error, executedAt: deps.now() });
  const record: PendingRecord = { ...claimed, status, result, error: result.error };
  return status === "executed" ? { outcome: "executed", record } : { outcome: "failed", record };
}

export async function cancelAction(repo: PendingRepo, id: string, userId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await repo.get(id, userId);
  if (!row) return { ok: false, reason: "That action doesn't exist." };
  if (row.status !== "awaiting_confirmation") return { ok: false, reason: REJECT_REASON[row.status] };
  const ok = await repo.transition(id, userId, "awaiting_confirmation", { status: "cancelled" });
  return ok ? { ok: true } : { ok: false, reason: "This action is no longer waiting for confirmation." };
}

/** New proposal for the steps after a failure; the user confirms it like any other. */
export async function retryRemaining(
  repo: PendingRepo,
  now: Clock,
  id: string,
  userId: string,
): Promise<{ ok: true; record: PendingRecord } | { ok: false; reason: string }> {
  const row = await repo.get(id, userId);
  if (!row) return { ok: false, reason: "That action doesn't exist." };
  if (row.status !== "failed" || !row.result || row.result.failedIndex === null) {
    return { ok: false, reason: "Only a failed action can be retried." };
  }
  if (row.result.stale) return { ok: false, reason: "This proposal was out of date. Ask the assistant to propose an updated one." };
  const remaining = row.steps.slice(row.result.failedIndex);
  if (remaining.length === 0) return { ok: false, reason: "Nothing left to retry." };
  const record = await propose(repo, now, { userId, chatSessionId: row.chatSessionId, turnId: null, steps: remaining });
  return { ok: true, record };
}

/* ------------------------------------------------------------------- Undo */

export function undoableSteps(result: ExecutionResult | null): StepRecord[] {
  return (result?.steps ?? []).filter((s) => s.ok && s.undo.length > 0);
}

export async function undoAction(
  deps: { repo: PendingRepo; runUndo: (op: UndoOp) => Promise<void> },
  id: string,
  userId: string,
): Promise<{ ok: true; undoneSteps: number; errors: string[] } | { ok: false; reason: string }> {
  const row = await deps.repo.get(id, userId);
  if (!row) return { ok: false, reason: "That action doesn't exist." };
  if (row.status !== "executed" && row.status !== "failed") return { ok: false, reason: "Only completed actions can be undone." };
  const steps = undoableSteps(row.result);
  if (steps.length === 0) return { ok: false, reason: "Nothing in this action can be undone." };
  if (!(await deps.repo.markUndone(id, userId))) return { ok: false, reason: "This action was already undone." };

  const errors: string[] = [];
  let undoneSteps = 0;
  for (const step of [...steps].reverse()) {
    let stepOk = true;
    for (const op of [...step.undo].reverse()) {
      try {
        await deps.runUndo(op);
      } catch (err) {
        stepOk = false;
        errors.push(`${step.summary}: ${errorText(err)}`);
      }
    }
    if (stepOk) undoneSteps++;
  }
  return { ok: true, undoneSteps, errors };
}

/* -------------------------------------------------------------- Chat text */

const AFFIRMATIVE =
  /^(?:y|ya|yep|yup|yes|yeah|yea|sure|ok|okay|k|confirm(?:ed)?|approved?|do it|go(?: for it| ahead)?|proceed|sounds good|looks good|lgtm|perfect|please do|ship it)(?:[\s,]+(?:please|thanks|thank you|go ahead|do it|proceed|confirm))*[\s.!]*$/i;

const NEGATIVE = /^(?:no|nope|nah|cancel|stop|don'?t|do not|never ?mind|nvm|abort|hold off|wait)\b/i;

/** Unambiguous "yes / go ahead / do it" — nothing else in the message. */
export function isAffirmative(text: string): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 0 && t.length <= 40 && AFFIRMATIVE.test(t);
}

export function isNegative(text: string): boolean {
  return NEGATIVE.test(text.trim());
}

/* ------------------------------------------------------------------- View */

export function toView(row: PendingRecord): PendingActionView {
  const results: StepResultView[] = (row.result?.steps ?? []).map((s) => ({
    index: s.index,
    tool: s.tool,
    ok: s.ok,
    summary: s.summary,
    error: s.error,
    undoable: s.ok && s.undo.length > 0,
  }));
  const steps: StepPreview[] = row.steps.map((s) => ({ tool: s.tool, summary: s.summary }));
  return {
    id: row.id,
    status: row.status,
    steps,
    results,
    failedIndex: row.result?.failedIndex ?? null,
    error: row.result?.error ?? row.error,
    stale: Boolean(row.result?.stale),
    undone: row.undone,
    expiresAt: row.expiresAt.toISOString(),
  };
}
