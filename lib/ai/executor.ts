import "server-only";
import { env } from "@/lib/env";
import type { ApplicationStage, CompanyStatus, CompanyTier, ContactRelationship, FocusStatus, IncomeStatus, IncomeType } from "@/lib/db/schema";
import {
  completeTask,
  createTask,
  getTaskFresh,
  getWritableTask,
  markNext,
  moveTask,
  reopenTask,
  rescheduleTask,
  rollbackCreatedTask,
  updateTask,
  type RescheduleInput,
} from "@/lib/todoist";
import { NEXT_LABEL, type TaskLite } from "@/lib/todoist/types";
import { listGroups } from "@/lib/domain/groups";
import { groupForTask, isWritableLocation, targetForGroup, type TodoistTarget } from "@/lib/domain/group-mapping";
import { localTime } from "@/lib/domain/time";
import { logActivity, removeActivity } from "@/lib/services/activity";
import { getApplication, restoreApplication, upsertApplication } from "@/lib/services/applications";
import { getContact, logTouch, restoreContact, upsertContact, type TouchType } from "@/lib/services/contacts";
import { companyFingerprint, getCompany, restoreCompany, upsertCompany } from "@/lib/services/companies";
import { tierLabel } from "@/lib/domain/company-tier";
import { logSideIncomeHours, upsertIncomeOption } from "@/lib/services/income";
import { listFocusItems, setFocusStatus } from "@/lib/services/focus";
import { getWeeklyReview, saveWeeklyReview, type ReviewInput } from "@/lib/services/targets";
import type { ServiceCtx } from "@/lib/services/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  cancelAction,
  confirmAction,
  retryRemaining,
  undoAction,
  type ActionStep,
  type ConfirmDeps,
  type StepOutcome,
  type UndoOp,
} from "./pending-actions";
import { pendingRepo } from "./pending-repo";

/* ------------------------------------------------------------ Step params */

export type StepParamMap = {
  create_task: {
    groupId: string;
    groupName: string;
    target: TodoistTarget;
    content: string;
    description?: string;
    dueString?: string;
    priority?: number;
    next?: boolean;
    parentId?: string;
  };
  update_task: {
    taskId: string;
    content?: string;
    description?: string;
    priority?: number;
    addLabels?: string[];
    removeLabels?: string[];
    setNext?: boolean;
  };
  reschedule_task: { taskId: string; change: RescheduleInput };
  complete_task: { taskId: string };
  move_task: { taskId: string; target: TodoistTarget; groupName: string };
  upsert_application: {
    id?: string;
    companyName?: string;
    role?: string;
    url?: string | null;
    stage?: ApplicationStage;
    nextFollowUpAt?: string | null;
    notes?: string | null;
  };
  upsert_contact: {
    id?: string;
    name?: string;
    company?: string | null;
    relationship?: ContactRelationship;
    channel?: string | null;
    nextCheckInAt?: string | null;
    notes?: string | null;
  };
  log_touch: { contactId: string; type: TouchType; nextCheckInAt?: string | null; note?: string };
  upsert_company: { id?: string; name?: string; domain?: string | null; description?: string | null; why?: string | null; rolesOfInterest?: string | null; status?: CompanyStatus; tier?: CompanyTier | null; notes?: string | null };
  upsert_side_income_option: {
    id?: string;
    name?: string;
    type?: IncomeType;
    expectedHourly?: number | null;
    hoursPerWeek?: number | null;
    status?: IncomeStatus;
    verdictNotes?: string | null;
  };
  log_side_income_hours: { hours: number; optionId?: string | null; override?: boolean };
  set_focus_item_status: { itemId: string; status: FocusStatus };
  save_weekly_review: { weekStart: string; fields: ReviewInput };
};

export type StepTool = keyof StepParamMap;

export function makeStep<T extends StepTool>(tool: T, summary: string, params: StepParamMap[T], fingerprint?: string | null): ActionStep {
  return { tool, summary, params: params as Record<string, unknown>, fingerprint: fingerprint ?? null };
}

/* ----------------------------------------------------------- Fingerprints */

export function taskFingerprint(t: TaskLite): string {
  return JSON.stringify([t.content, t.due?.date ?? null, t.due?.datetime ?? null, t.projectId, t.sectionId]);
}

const toDate = (s: string | null | undefined) => (s === undefined ? undefined : s === null ? null : new Date(s));

/** JSON round-trips turn Dates into strings; restore `*At` fields before writing snapshots back. */
function revive<T extends Record<string, unknown>>(snapshot: T): T {
  const out: Record<string, unknown> = { ...snapshot };
  for (const [k, v] of Object.entries(out)) {
    if (k.endsWith("At") && typeof v === "string") out[k] = new Date(v);
  }
  return out as T;
}

function restoreDueFor(t: TaskLite, tz: string): RescheduleInput {
  if (!t.due) return { clear: true };
  if (!t.due.datetime) return { date: t.due.date };
  const dt = t.due.datetime;
  const floating = !/[zZ]|[+-]\d{2}:?\d{2}$/.test(dt);
  const time = floating ? dt.slice(11, 16) : localTime(new Date(dt), tz);
  return { date: t.due.date, time };
}

/* ---------------------------------------------------------------- Runner */

export function createStepRunner(ctx: ServiceCtx) {
  const tz = ctx.tz;

  async function runStep(step: ActionStep): Promise<StepOutcome> {
    switch (step.tool as StepTool) {
      case "create_task": {
        const p = step.params as StepParamMap["create_task"];
        const labels = p.next ? [NEXT_LABEL] : undefined;
        const task = await createTask(ctx.userId, p.target, {
          content: p.content,
          description: p.description,
          dueString: p.dueString,
          priority: p.priority,
          labels,
          parentId: p.parentId,
        });
        if (p.next) await markNext(ctx.userId, task.id);
        return { undo: [{ kind: "delete_created_task", taskId: task.id }] };
      }
      case "update_task": {
        const p = step.params as StepParamMap["update_task"];
        const before = await getWritableTask(ctx.userId, p.taskId);
        let labels = before.labels;
        if (p.addLabels?.length) labels = Array.from(new Set([...labels, ...p.addLabels]));
        if (p.removeLabels?.length) labels = labels.filter((l) => !p.removeLabels!.includes(l));
        if (p.setNext === false) labels = labels.filter((l) => l !== NEXT_LABEL);
        const changed = p.addLabels?.length || p.removeLabels?.length || p.setNext === false;
        await updateTask(ctx.userId, p.taskId, {
          ...(p.content !== undefined && { content: p.content }),
          ...(p.description !== undefined && { description: p.description }),
          ...(p.priority !== undefined && { priority: p.priority }),
          ...(changed && { labels }),
        });
        if (p.setNext === true) await markNext(ctx.userId, p.taskId);
        return {
          undo: [
            {
              kind: "restore_task",
              taskId: p.taskId,
              content: before.content,
              description: before.description,
              priority: before.priority,
              labels: before.labels,
            },
          ],
        };
      }
      case "reschedule_task": {
        const p = step.params as StepParamMap["reschedule_task"];
        const before = await getWritableTask(ctx.userId, p.taskId);
        await rescheduleTask(ctx.userId, p.taskId, p.change);
        return { undo: [{ kind: "restore_due", taskId: p.taskId, change: restoreDueFor(before, tz) }] };
      }
      case "complete_task": {
        const p = step.params as StepParamMap["complete_task"];
        const task = await completeTask(ctx.userId, p.taskId);
        const group = groupForTask(task, await listGroups(ctx.userId));
        const act = await logActivity(ctx, { type: "task_completed", groupId: group?.id, refType: "todoist_task", refId: task.id });
        return {
          undo: [
            { kind: "reopen_task", taskId: task.id },
            { kind: "remove_activity", activityId: act.id },
          ],
        };
      }
      case "move_task": {
        const p = step.params as StepParamMap["move_task"];
        const before = await getWritableTask(ctx.userId, p.taskId);
        await moveTask(ctx.userId, p.taskId, p.target);
        return { undo: [{ kind: "move_task_back", taskId: p.taskId, target: { projectId: before.projectId, sectionId: before.sectionId } }] };
      }
      case "upsert_application": {
        const p = step.params as StepParamMap["upsert_application"];
        const res = await upsertApplication(ctx, { ...p, nextFollowUpAt: toDate(p.nextFollowUpAt) });
        const undo: UndoOp[] = [
          { kind: "restore_application", snapshot: res.previous, createdId: res.previous ? undefined : res.application.id },
        ];
        if (res.activityId) undo.push({ kind: "remove_activity", activityId: res.activityId });
        return { undo };
      }
      case "upsert_contact": {
        const p = step.params as StepParamMap["upsert_contact"];
        const res = await upsertContact(ctx, { ...p, nextCheckInAt: toDate(p.nextCheckInAt) });
        return { undo: [{ kind: "restore_contact", snapshot: res.previous, createdId: res.previous ? undefined : res.contact.id }] };
      }
      case "log_touch": {
        const p = step.params as StepParamMap["log_touch"];
        const res = await logTouch(ctx, { ...p, nextCheckInAt: toDate(p.nextCheckInAt) });
        return {
          undo: [
            { kind: "restore_contact", snapshot: res.previous },
            { kind: "remove_activity", activityId: res.activityId },
          ],
        };
      }
      case "upsert_company": {
        const p = step.params as StepParamMap["upsert_company"];
        const res = await upsertCompany(ctx, p);
        const undo: UndoOp[] = [{ kind: "restore_company", snapshot: res.previous, createdId: res.previous ? undefined : res.company.id }];
        if (res.createdTask) undo.push({ kind: "delete_created_task", taskId: res.createdTask.id });
        return {
          summary: res.createdTask ? `${step.summary} (created “${res.createdTask.content}” in ${res.createdTask.groupName})` : undefined,
          undo,
        };
      }
      case "upsert_side_income_option": {
        const p = step.params as StepParamMap["upsert_side_income_option"];
        const res = await upsertIncomeOption(ctx, p);
        return res.previous
          ? {
              undo: [
                {
                  kind: "restore_income_option",
                  id: res.previous.id,
                  fields: {
                    name: res.previous.name,
                    type: res.previous.type,
                    expectedHourly: res.previous.expectedHourly,
                    hoursPerWeek: res.previous.hoursPerWeek,
                    status: res.previous.status,
                    verdictNotes: res.previous.verdictNotes,
                  },
                },
              ],
            }
          : {};
      }
      case "log_side_income_hours": {
        const p = step.params as StepParamMap["log_side_income_hours"];
        const res = await logSideIncomeHours(ctx, p);
        return {
          summary: `${step.summary} (${res.totalAfter} / ${res.cap}h this week)`,
          undo: [{ kind: "remove_activity", activityId: res.activity.id }],
        };
      }
      case "set_focus_item_status": {
        const p = step.params as StepParamMap["set_focus_item_status"];
        const res = await setFocusStatus(ctx, p.itemId, p.status);
        return { undo: [{ kind: "set_focus_status", itemId: p.itemId, status: res.previousStatus }] };
      }
      case "save_weekly_review": {
        const p = step.params as StepParamMap["save_weekly_review"];
        const previous = await getWeeklyReview(ctx.userId, p.weekStart);
        await saveWeeklyReview(ctx, p.weekStart, p.fields);
        return previous
          ? {
              undo: [
                {
                  kind: "restore_review",
                  weekStart: p.weekStart,
                  fields: {
                    accomplished: previous.accomplished,
                    productive: previous.productive,
                    notProductive: previous.notProductive,
                    demandRating: previous.demandRating,
                    routines: previous.routines,
                    changes: previous.changes,
                  },
                },
              ],
            }
          : {};
      }
      default:
        throw new ValidationError(`Unknown step "${step.tool}".`);
    }
  }

  /** Returns a reason when any referenced entity drifted since the proposal. */
  async function revalidate(steps: ActionStep[]): Promise<string | null> {
    const groups = await listGroups(ctx.userId);
    for (const step of steps) {
      const tool = step.tool as StepTool;
      const p = step.params as Record<string, unknown>;
      try {
        if (tool === "create_task") {
          const cp = p as StepParamMap["create_task"];
          const g = groups.find((x) => x.id === cp.groupId);
          if (!g || g.archivedAt) return `${cp.groupName} is no longer an active group.`;
          const t = targetForGroup(g);
          if (!t || t.projectId !== cp.target.projectId || t.sectionId !== cp.target.sectionId) {
            return `${cp.groupName}'s Todoist mapping changed.`;
          }
          if (cp.parentId) await getTaskFresh(cp.parentId);
        } else if (tool === "update_task" || tool === "reschedule_task" || tool === "complete_task" || tool === "move_task") {
          const taskId = p.taskId as string;
          const task = await getTaskFresh(taskId).catch((err) => {
            if (err instanceof NotFoundError) throw new ValidationError(`the task in “${step.summary}” was completed or deleted`);
            throw err;
          });
          if (!isWritableLocation(task, groups)) return `“${task.content}” is no longer in a dashboard group.`;
          if (step.fingerprint && step.fingerprint !== taskFingerprint(task)) {
            return `“${task.content}” was edited since I proposed this${task.due ? ` (it's now due ${task.due.string || task.due.date})` : ""}.`;
          }
          if (tool === "move_task") {
            const mp = p as StepParamMap["move_task"];
            if (!isWritableLocation(mp.target, groups)) return `${mp.groupName} is no longer an active group.`;
          }
        } else if (tool === "upsert_application" && p.id) {
          const a = await getApplication(ctx.userId, p.id as string);
          if (step.fingerprint && step.fingerprint !== a.stage) return `${a.companyName} – ${a.role} moved to “${a.stage}” in the meantime.`;
        } else if ((tool === "upsert_contact" && p.id) || tool === "log_touch") {
          await getContact(ctx.userId, (p.id ?? p.contactId) as string);
        } else if (tool === "upsert_company" && p.id) {
          const c = await getCompany(ctx.userId, p.id as string);
          if (step.fingerprint && step.fingerprint !== companyFingerprint(c)) {
            return `${c.name} changed in the meantime (now “${c.status}”, ${tierLabel(c.tier)}).`;
          }
        } else if (tool === "set_focus_item_status") {
          const item = (await listFocusItems(ctx.userId)).find((i) => i.id === p.itemId);
          if (!item) return "That focus item no longer exists.";
          if (step.fingerprint && step.fingerprint !== item.status) return `“${item.title}” is now ${item.status}.`;
        }
      } catch (err) {
        return err instanceof Error ? err.message : "Something changed since the proposal.";
      }
    }
    return null;
  }

  async function runUndo(op: UndoOp): Promise<void> {
    switch (op.kind) {
      case "delete_created_task":
        return rollbackCreatedTask(op.taskId as string);
      case "reopen_task":
        return reopenTask(op.taskId as string);
      case "restore_task": {
        const labels = op.labels as string[];
        await updateTask(ctx.userId, op.taskId as string, {
          content: op.content as string,
          description: op.description as string,
          priority: op.priority as number,
          labels,
        });
        return;
      }
      case "restore_due":
        await rescheduleTask(ctx.userId, op.taskId as string, op.change as RescheduleInput);
        return;
      case "move_task_back":
        await moveTask(ctx.userId, op.taskId as string, op.target as TodoistTarget);
        return;
      case "remove_activity":
        return removeActivity(ctx.userId, op.activityId as string);
      case "restore_application":
        return restoreApplication(ctx.userId, op.snapshot ? revive(op.snapshot as never) : null, op.createdId as string | undefined);
      case "restore_contact":
        return restoreContact(ctx.userId, op.snapshot ? revive(op.snapshot as never) : null, op.createdId as string | undefined);
      case "restore_company":
        return restoreCompany(ctx.userId, op.snapshot ? revive(op.snapshot as never) : null, op.createdId as string | undefined);
      case "restore_income_option":
        await upsertIncomeOption(ctx, { id: op.id as string, ...(op.fields as object) });
        return;
      case "set_focus_status":
        await setFocusStatus(ctx, op.itemId as string, op.status as FocusStatus);
        return;
      case "restore_review":
        await saveWeeklyReview(ctx, op.weekStart as string, op.fields as ReviewInput);
        return;
      default:
        throw new Error(`Can't undo "${op.kind}".`);
    }
  }

  return { runStep, revalidate, runUndo };
}

/* --------------------------------------------------------------- Facade */

function assistantCtx(userId: string): ServiceCtx {
  return { userId, source: "assistant", tz: env.APP_TIMEZONE };
}

function deps(userId: string): ConfirmDeps & { runUndo: (op: UndoOp) => Promise<void> } {
  const runner = createStepRunner(assistantCtx(userId));
  return { repo: pendingRepo, now: () => new Date(), revalidate: runner.revalidate, runStep: runner.runStep, runUndo: runner.runUndo };
}

export const actions = {
  confirm: (userId: string, id: string) => confirmAction(deps(userId), id, userId),
  cancel: (userId: string, id: string) => cancelAction(pendingRepo, id, userId),
  retry: (userId: string, id: string) => retryRemaining(pendingRepo, () => new Date(), id, userId),
  undo: (userId: string, id: string) => undoAction(deps(userId), id, userId),
  get: (userId: string, id: string) => pendingRepo.get(id, userId),
};
