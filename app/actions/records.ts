"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { run } from "./_run";
import {
  applicationStage,
  companyStatus,
  companyTier,
  contactRelationship,
  focusStatus,
  incomeStatus,
  incomeType,
  storyKind,
} from "@/lib/db/schema";
import { upsertApplication } from "@/lib/services/applications";
import { logTouch, upsertContact } from "@/lib/services/contacts";
import { upsertCompany } from "@/lib/services/companies";
import { addQuestion, logPrepSession, saveStory, setPracticed, upsertInterview } from "@/lib/services/prep";
import { logSideIncomeHours, upsertIncomeOption } from "@/lib/services/income";
import { setFocusStatus, upsertFocusItem } from "@/lib/services/focus";
import { clearWeekOverrides, saveWeeklyReview, setTarget } from "@/lib/services/targets";
import { METRICS, type MetricKey } from "@/lib/domain/scorecard";

const optText = z.string().trim().max(5000).nullish().transform((v) => (v ? v : null));
const optDate = z
  .string()
  .nullish()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), "Invalid date");
const uuid = z.uuid();

function refresh() {
  revalidatePath("/", "layout");
}

/* ------------------------------------------------------------ Applications */

const applicationSchema = z.object({
  id: uuid.optional(),
  companyName: z.string().trim().min(1).max(120).optional(),
  role: z.string().trim().min(1).max(160).optional(),
  url: z.string().trim().max(2000).nullish(),
  stage: z.enum(applicationStage.enumValues).optional(),
  nextFollowUpAt: optDate.optional(),
  notes: optText.optional(),
});

export async function saveApplicationAction(input: z.input<typeof applicationSchema>) {
  return run(async (ctx) => {
    const data = applicationSchema.parse(input);
    const res = await upsertApplication(ctx, { ...data, url: data.url || null });
    refresh();
    return { id: res.application.id, loggedApplication: Boolean(res.activityId) };
  });
}

/* ---------------------------------------------------------------- Contacts */

const contactSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  company: optText.optional(),
  relationship: z.enum(contactRelationship.enumValues).optional(),
  channel: optText.optional(),
  nextCheckInAt: optDate.optional(),
  notes: optText.optional(),
});

export async function saveContactAction(input: z.input<typeof contactSchema>) {
  return run(async (ctx) => {
    const res = await upsertContact(ctx, contactSchema.parse(input));
    refresh();
    return { id: res.contact.id };
  });
}

export async function logTouchAction(input: { contactId: string; type: "outreach" | "follow_up" | "conversation"; nextCheckInAt?: string | null; note?: string }) {
  return run(async (ctx) => {
    const data = z
      .object({
        contactId: uuid,
        type: z.enum(["outreach", "follow_up", "conversation"]),
        nextCheckInAt: optDate.optional(),
        note: z.string().trim().max(1000).optional(),
      })
      .parse(input);
    await logTouch(ctx, data);
    refresh();
    return null;
  });
}

/* --------------------------------------------------------------- Companies */

const companySchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  domain: z.string().trim().max(253).nullish(),
  description: optText.optional(),
  why: optText.optional(),
  rolesOfInterest: optText.optional(),
  status: z.enum(companyStatus.enumValues).optional(),
  tier: z.enum(companyTier.enumValues).nullish(),
  notes: optText.optional(),
});

export async function saveCompanyAction(input: z.input<typeof companySchema>) {
  return run(async (ctx) => {
    const res = await upsertCompany(ctx, companySchema.parse(input));
    refresh();
    return { id: res.company.id, createdTask: res.createdTask };
  });
}

/* -------------------------------------------------------------------- Prep */

export async function saveInterviewAction(input: {
  id?: string;
  applicationId?: string | null;
  scheduledAt: string;
  stage?: string;
  interviewer?: string;
  prepNotes?: string;
}) {
  return run(async (ctx) => {
    const data = z
      .object({
        id: uuid.optional(),
        applicationId: uuid.nullish(),
        scheduledAt: z.string().min(1).transform((v) => new Date(v)),
        stage: optText.optional(),
        interviewer: optText.optional(),
        prepNotes: optText.optional(),
      })
      .parse(input);
    await upsertInterview(ctx, data);
    refresh();
    return null;
  });
}

export async function addQuestionAction(input: { question: string; category?: string }) {
  return run(async (ctx) => {
    const data = z.object({ question: z.string().trim().min(1).max(500), category: optText.optional() }).parse(input);
    await addQuestion(ctx, data);
    refresh();
    return null;
  });
}

export async function setPracticedAction(questionId: string, practiced: boolean) {
  return run(async (ctx) => {
    await setPracticed(ctx, uuid.parse(questionId), practiced);
    refresh();
    return null;
  });
}

export async function saveStoryAction(kind: string, bodyMd: string) {
  return run(async (ctx) => {
    await saveStory(ctx, z.enum(storyKind.enumValues).parse(kind), z.string().max(20000).parse(bodyMd));
    refresh();
    return null;
  });
}

export async function logPrepSessionAction() {
  return run(async (ctx) => {
    await logPrepSession(ctx);
    refresh();
    return null;
  });
}

/* ------------------------------------------------------------ Side income */

const incomeSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  type: z.enum(incomeType.enumValues).optional(),
  expectedHourly: z.number().min(0).max(10000).nullish(),
  hoursPerWeek: z.number().min(0).max(168).nullish(),
  status: z.enum(incomeStatus.enumValues).optional(),
  verdictNotes: optText.optional(),
});

export async function saveIncomeOptionAction(input: z.input<typeof incomeSchema>) {
  return run(async (ctx) => {
    await upsertIncomeOption(ctx, incomeSchema.parse(input));
    refresh();
    return null;
  });
}

export async function logSideIncomeHoursAction(input: { hours: number; optionId?: string | null; override?: boolean }) {
  return run(async (ctx) => {
    const data = z
      .object({ hours: z.number().positive().max(24), optionId: uuid.nullish(), override: z.boolean().optional() })
      .parse(input);
    const res = await logSideIncomeHours(ctx, data);
    refresh();
    return { totalAfter: res.totalAfter, cap: res.cap, overCap: res.overCap };
  });
}

/* ------------------------------------------------------------------ Focus */

export async function saveFocusItemAction(input: { id?: string; title?: string; goal?: string | null; link?: string | null }) {
  return run(async (ctx) => {
    const data = z
      .object({
        id: uuid.optional(),
        title: z.string().trim().min(1).max(200).optional(),
        goal: optText.optional(),
        link: optText.optional(),
      })
      .parse(input);
    await upsertFocusItem(ctx, data);
    refresh();
    return null;
  });
}

export async function setFocusStatusAction(itemId: string, status: string) {
  return run(async (ctx) => {
    await setFocusStatus(ctx, uuid.parse(itemId), z.enum(focusStatus.enumValues).parse(status));
    refresh();
    return null;
  });
}

/* --------------------------------------------------------- Weekly review */

export async function saveWeeklyReviewAction(weekStart: string, input: {
  accomplished?: string;
  productive?: string;
  notProductive?: string;
  demandRating?: number | null;
  routines?: "yes" | "partly" | "no" | null;
  changes?: string;
}) {
  return run(async (ctx) => {
    const ws = z.iso.date().parse(weekStart);
    const data = z
      .object({
        accomplished: optText.optional(),
        productive: optText.optional(),
        notProductive: optText.optional(),
        demandRating: z.number().int().min(1).max(5).nullish(),
        routines: z.enum(["yes", "partly", "no"]).nullish(),
        changes: optText.optional(),
      })
      .parse(input);
    await saveWeeklyReview(ctx, ws, data);
    refresh();
    return null;
  });
}

const targetsSchema = z.array(
  z.object({
    metric: z.enum(METRICS.map((m) => m.key) as [MetricKey, ...MetricKey[]]),
    min: z.number().min(0).max(1000).nullable(),
    max: z.number().min(0).max(1000).nullable(),
  }),
);

/** weekStart null = defaults (Settings); a date = per-week override (Scorecard). */
export async function saveTargetsAction(weekStart: string | null, rows: z.input<typeof targetsSchema>) {
  return run(async (ctx) => {
    const ws = weekStart === null ? null : z.iso.date().parse(weekStart);
    for (const r of targetsSchema.parse(rows)) await setTarget(ctx.userId, ws, r.metric, r.min, r.max);
    refresh();
    return null;
  });
}

export async function clearWeekOverridesAction(weekStart: string) {
  return run(async (ctx) => {
    await clearWeekOverrides(ctx.userId, z.iso.date().parse(weekStart));
    refresh();
    return null;
  });
}
