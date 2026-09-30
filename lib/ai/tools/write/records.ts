import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { applicationStage, companyStatus, contactRelationship, focusStatus, incomeStatus, incomeType } from "@/lib/db/schema";
import { getApplication, STAGE_LABEL } from "@/lib/services/applications";
import { getContact } from "@/lib/services/contacts";
import { getCompany, readyTaskTitle } from "@/lib/services/companies";
import { sideIncomeHoursThisWeek, listIncomeOptions } from "@/lib/services/income";
import { FOCUS_ACTIVE_LIMIT, listFocusItems } from "@/lib/services/focus";
import { getGroupByKind } from "@/lib/domain/groups";
import { dayRange, mondayOf, weekRange } from "@/lib/domain/time";
import { makeStep } from "@/lib/ai/executor";
import { fmtDay, isoDate, serviceCtx, type ToolCtx } from "../context";
import { proposeSteps } from "./propose";

const b = (s: string) => `**${s}**`;
const COMPANY_LABEL = { researching: "Researching", ready_to_apply: "Ready to apply", ready_to_reach_out: "Ready to reach out", done: "Done" } as const;
const TOUCH_LABEL = { outreach: "outreach", follow_up: "follow-up", conversation: "conversation" } as const;

export function recordWriteTools(tc: ToolCtx) {
  /** Local calendar date → ISO instant at 9am local, used for check-in / follow-up dates. */
  const at9 = (date: string | null | undefined) => (date ? new Date(dayRange(date, tc.tz).start.getTime() + 9 * 3600_000).toISOString() : date);

  return {
    upsert_application: tool({
      description:
        "PROPOSE creating an application (needs companyName + role) or updating one by id: stage, link, follow-up date, notes (requires confirmation). Moving to Applied logs an application for the scorecard. Search first so you don't create duplicates.",
      inputSchema: z.object({
        id: z.uuid().optional(),
        companyName: z.string().trim().min(1).max(120).optional(),
        role: z.string().trim().min(1).max(160).optional(),
        url: z.url().optional(),
        stage: z.enum(applicationStage.enumValues).optional(),
        nextFollowUpDate: z.string().regex(isoDate).nullish(),
        notes: z.string().max(4000).optional(),
      }),
      execute: (input) =>
        proposeSteps(tc, async () => {
          const params = {
            id: input.id,
            companyName: input.companyName,
            role: input.role,
            url: input.url,
            stage: input.stage,
            nextFollowUpAt: at9(input.nextFollowUpDate),
            notes: input.notes,
          };
          if (input.id) {
            const a = await getApplication(tc.userId, input.id);
            const label = `${input.companyName ?? a.companyName} – ${input.role ?? a.role}`;
            const parts: string[] = [];
            if (input.stage && input.stage !== a.stage) parts.push(`move ${b(label)} to ${b(STAGE_LABEL[input.stage])}${input.stage === "applied" ? " (logs 1 application this week)" : ""}`);
            if (input.nextFollowUpDate) parts.push(`set follow-up to ${fmtDay(input.nextFollowUpDate)}`);
            if (input.url) parts.push("save the posting link");
            if (input.notes !== undefined) parts.push("update notes");
            if (input.companyName || input.role) parts.push("rename it");
            if (parts.length === 0) return { error: "Nothing to change on that application." };
            const summary = parts[0].startsWith("move") ? parts.join(", ") : `Update ${b(label)}: ${parts.join(", ")}`;
            return [makeStep("upsert_application", summary.charAt(0).toUpperCase() + summary.slice(1), params, a.stage)];
          }
          if (!input.companyName || !input.role) return { error: "A new application needs companyName and role." };
          const stage = input.stage ?? "researching";
          return [
            makeStep(
              "upsert_application",
              `Add application ${b(`${input.companyName} – ${input.role}`)} at ${b(STAGE_LABEL[stage])}${stage === "applied" ? " (logs 1 application this week)" : ""}${input.nextFollowUpDate ? `, follow-up ${fmtDay(input.nextFollowUpDate)}` : ""}`,
              { ...params, stage },
            ),
          ];
        }),
    }),

    upsert_contact: tool({
      description: "PROPOSE creating (needs name) or updating a contact: company, relationship, channel, next check-in, notes (requires confirmation).",
      inputSchema: z.object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1).max(120).optional(),
        company: z.string().max(120).optional(),
        relationship: z.enum(contactRelationship.enumValues).optional(),
        channel: z.string().max(60).optional(),
        nextCheckInDate: z.string().regex(isoDate).nullish(),
        notes: z.string().max(4000).optional(),
      }),
      execute: (input) =>
        proposeSteps(tc, async () => {
          const params = {
            id: input.id,
            name: input.name,
            company: input.company,
            relationship: input.relationship,
            channel: input.channel,
            nextCheckInAt: at9(input.nextCheckInDate),
            notes: input.notes,
          };
          if (input.id) {
            const c = await getContact(tc.userId, input.id);
            return [makeStep("upsert_contact", `Update contact ${b(c.name)}${input.nextCheckInDate ? `: next check-in ${fmtDay(input.nextCheckInDate)}` : ""}`, params)];
          }
          if (!input.name) return { error: "A new contact needs a name." };
          return [makeStep("upsert_contact", `Add contact ${b(input.name)}${input.company ? ` (${input.company})` : ""}`, params)];
        }),
    }),

    log_touch: tool({
      description:
        "PROPOSE logging an outreach, follow-up or conversation with a contact (counts toward weekly targets) and setting the next check-in (default +7 days, +14 after a conversation). Requires confirmation.",
      inputSchema: z.object({
        contactId: z.uuid(),
        type: z.enum(["outreach", "follow_up", "conversation"]),
        nextCheckInDate: z.string().regex(isoDate).optional(),
        note: z.string().max(1000).optional(),
      }),
      execute: (input) =>
        proposeSteps(tc, async () => {
          const c = await getContact(tc.userId, input.contactId);
          return [
            makeStep(
              "log_touch",
              `Log a ${TOUCH_LABEL[input.type]} with ${b(c.name)}${input.nextCheckInDate ? `, next check-in ${fmtDay(input.nextCheckInDate)}` : ""}`,
              { contactId: c.id, type: input.type, nextCheckInAt: at9(input.nextCheckInDate), note: input.note },
            ),
          ];
        }),
    }),

    upsert_company: tool({
      description:
        "PROPOSE creating (needs name) or updating a target company (requires confirmation). Setting status ready_to_apply / ready_to_reach_out also creates the linked to-do in Applications / Networking & Follow-ups.",
      inputSchema: z.object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1).max(120).optional(),
        domain: z.string().trim().max(253).optional().describe("Website domain, e.g. ramp.com (from lookup_company)"),
        description: z.string().max(1000).optional().describe("What the company does (from lookup_company)"),
        why: z.string().max(2000).optional(),
        rolesOfInterest: z.string().max(500).optional(),
        status: z.enum(companyStatus.enumValues).optional(),
        notes: z.string().max(4000).optional(),
      }),
      execute: (input) =>
        proposeSteps(tc, async () => {
          const prev = input.id ? await getCompany(tc.userId, input.id) : null;
          if (!prev && !input.name) return { error: "A new company needs a name." };
          const name = input.name ?? prev!.name;
          let summary = prev ? `Update ${b(name)}` : `Add target company ${b(name)}${input.domain ? ` (${input.domain})` : ""}`;
          if (input.status && input.status !== prev?.status) {
            summary = prev ? `Mark ${b(name)} as ${b(COMPANY_LABEL[input.status])}` : `${summary} as ${b(COMPANY_LABEL[input.status])}`;
            const title = readyTaskTitle({ name, rolesOfInterest: input.rolesOfInterest ?? prev?.rolesOfInterest ?? null }, input.status);
            if (title) {
              const g = await getGroupByKind(tc.userId, input.status === "ready_to_apply" ? "pipeline" : "people");
              if (!g || !g.todoistProjectId) return { error: "The group for the linked to-do isn't mapped to Todoist, so the task can't be created." };
              summary += ` (creates “${title}” in ${g.name})`;
            }
          }
          return [makeStep("upsert_company", summary, input, prev?.status ?? null)];
        }),
    }),

    upsert_side_income_option: tool({
      description: "PROPOSE creating (needs name) or updating a side-income option (requires confirmation).",
      inputSchema: z.object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1).max(120).optional(),
        type: z.enum(incomeType.enumValues).optional(),
        expectedHourly: z.number().min(0).max(10000).optional(),
        hoursPerWeek: z.number().min(0).max(40).optional(),
        status: z.enum(incomeStatus.enumValues).optional(),
        verdictNotes: z.string().max(2000).optional(),
      }),
      execute: (input) =>
        proposeSteps(tc, async () => {
          if (input.id) {
            const prev = (await listIncomeOptions(tc.userId)).find((o) => o.id === input.id);
            if (!prev) return { error: "That income option doesn't exist." };
            return [makeStep("upsert_side_income_option", `Update ${b(prev.name)}${input.status ? ` → ${input.status}` : ""}`, input)];
          }
          if (!input.name) return { error: "A new option needs a name." };
          return [makeStep("upsert_side_income_option", `Add side-income option ${b(input.name)}`, input)];
        }),
    }),

    log_side_income_hours: tool({
      description:
        "PROPOSE logging side-income hours (requires confirmation). If it would exceed the weekly cap this returns an error: warn the user and only retry with override=true after they explicitly say to go over the cap.",
      inputSchema: z.object({ hours: z.number().positive().max(24), optionId: z.uuid().optional(), override: z.boolean().optional() }),
      execute: (input) =>
        proposeSteps(tc, async () => {
          const { hours, cap } = await sideIncomeHoursThisWeek(serviceCtx(tc));
          const after = Math.round((hours + input.hours) * 10) / 10;
          if (after > cap && !input.override) {
            return {
              error: `Over the cap: ${hours}h already logged this week; +${input.hours}h would make ${after}h against a ${cap}h cap (set to protect job-search time). Warn the user. Only propose again with override=true if they explicitly insist.`,
            };
          }
          const opt = input.optionId ? (await listIncomeOptions(tc.userId)).find((o) => o.id === input.optionId) : null;
          if (input.optionId && !opt) return { error: "That income option doesn't exist." };
          return [
            makeStep(
              "log_side_income_hours",
              `Log ${input.hours}h of side income${opt ? ` on ${b(opt.name)}` : ""}${after > cap ? ` (over the ${cap}h cap: ${after}h total)` : ""}`,
              { hours: input.hours, optionId: input.optionId ?? null, override: input.override },
            ),
          ];
        }),
    }),

    set_focus_item_status: tool({
      description: `PROPOSE activating, pausing, finishing or dropping a Personal Development item (requires confirmation). At most ${FOCUS_ACTIVE_LIMIT} can be active.`,
      inputSchema: z.object({ itemId: z.uuid(), status: z.enum(focusStatus.enumValues) }),
      execute: ({ itemId, status }) =>
        proposeSteps(tc, async () => {
          const items = await listFocusItems(tc.userId);
          const item = items.find((i) => i.id === itemId);
          if (!item) return { error: "That focus item doesn't exist." };
          if (item.status === status) return { error: `“${item.title}” is already ${status}.` };
          const active = items.filter((i) => i.status === "active");
          if (status === "active" && active.length >= FOCUS_ACTIVE_LIMIT) {
            return {
              error: `Finish or drop one first: ${active.map((i) => `“${i.title}”`).join(" and ")} are already active (limit ${FOCUS_ACTIVE_LIMIT}). Offer to pause, finish or drop one of them in the same proposal (that step must come first).`,
            };
          }
          const verb = { active: "Activate", paused: "Pause", done: "Mark done:", dropped: "Drop" }[status];
          return [makeStep("set_focus_item_status", `${verb} ${b(item.title)}`, { itemId, status }, item.status)];
        }),
    }),

    save_weekly_review: tool({
      description: "PROPOSE saving weekly-review fields for a week (default: current week). Requires confirmation.",
      inputSchema: z.object({
        weekStart: z.string().regex(isoDate).optional(),
        accomplished: z.string().max(4000).optional(),
        productive: z.string().max(4000).optional(),
        notProductive: z.string().max(4000).optional(),
        demandRating: z.number().int().min(1).max(5).optional(),
        routines: z.enum(["yes", "partly", "no"]).optional(),
        changes: z.string().max(4000).optional(),
      }),
      execute: ({ weekStart, ...fields }) =>
        proposeSteps(tc, async () => {
          const ws = weekStart ? mondayOf(weekStart) : weekRange(tc.now, tc.tz).weekStart;
          const set = Object.entries(fields).filter(([, v]) => v !== undefined);
          if (set.length === 0) return { error: "No review fields given." };
          return [makeStep("save_weekly_review", `Save the weekly review for the week of ${fmtDay(ws)} (${set.length} field${set.length > 1 ? "s" : ""})`, { weekStart: ws, fields })];
        }),
    }),
  };
}
