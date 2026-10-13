import "server-only";
import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  applications,
  interviews,
  prepQuestions,
  stories,
  type Application,
  type Interview,
  type PrepQuestion,
  type Story,
  type StoryKind,
} from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";
import { logActivity } from "./activity";
import { findApplicationsForCompany, getApplication } from "./applications";
import { nowOf, type ServiceCtx } from "./context";

export const STORY_KINDS: StoryKind[] = ["30s", "interview", "networking", "followups"];
export const STORY_LABEL: Record<StoryKind, string> = {
  "30s": "30-second",
  interview: "Interview",
  networking: "Networking",
  followups: "Follow-up Q&A",
};

export type InterviewWithApp = Interview & { companyName: string | null; role: string | null };

export async function listInterviews(userId: string, opts: { upcomingOnly?: boolean; now?: Date } = {}): Promise<InterviewWithApp[]> {
  const where = [eq(interviews.userId, userId)];
  if (opts.upcomingOnly) where.push(gte(interviews.scheduledAt, new Date((opts.now ?? new Date()).getTime() - 2 * 3600_000)));
  const rows = await db
    .select({ interview: interviews, companyName: applications.companyName, role: applications.role })
    .from(interviews)
    .leftJoin(applications, eq(applications.id, interviews.applicationId))
    .where(and(...where))
    .orderBy(asc(interviews.scheduledAt));
  return rows.map((r) => ({ ...r.interview, companyName: r.companyName, role: r.role }));
}

export type UpsertInterviewInput = {
  id?: string;
  applicationId?: string | null;
  scheduledAt?: Date;
  stage?: string | null;
  interviewer?: string | null;
  prepNotes?: string | null;
};

/**
 * Which application an interview is for: by id, else by company (+ role). Returns an error
 * message the assistant can act on when there's no match or several equally good ones.
 */
export async function resolveInterviewApplication(
  userId: string,
  ref: { applicationId?: string | null; companyName?: string | null; role?: string | null },
): Promise<{ application: Application } | { error: string }> {
  if (ref.applicationId) {
    try {
      return { application: await getApplication(userId, ref.applicationId) };
    } catch {
      return { error: "That application no longer exists." };
    }
  }
  if (!ref.companyName) return { error: "Say which company (or application) the interview is for." };
  const matches = await findApplicationsForCompany(userId, ref.companyName, ref.role);
  if (matches.length === 1) return { application: matches[0] };
  if (matches.length === 0) {
    const anyRole = ref.role ? await findApplicationsForCompany(userId, ref.companyName) : [];
    if (anyRole.length) return { error: `No ${ref.companyName} application matches “${ref.role}”. Their applications: ${anyRole.map((a) => a.role).join("; ")}.` };
    return { error: `There's no application for ${ref.companyName} yet. Add one with upsert_application (it needs a tier) in this same turn, before the interview.` };
  }
  return { error: `${ref.companyName} has ${matches.length} applications (${matches.map((a) => a.role).join("; ")}). Ask which role the interview is for.` };
}

export async function getInterview(userId: string, id: string): Promise<Interview> {
  const [row] = await db.select().from(interviews).where(and(eq(interviews.userId, userId), eq(interviews.id, id))).limit(1);
  if (!row) throw new NotFoundError("Interview not found.");
  return row;
}

/** Undo helper: put back a previous snapshot, or remove an interview created in the same action. */
export async function restoreInterview(userId: string, snapshot: Interview | null, createdId?: string) {
  if (snapshot) {
    const { id, userId: _u, createdAt: _c, ...rest } = snapshot;
    void _u;
    void _c;
    await db.update(interviews).set(rest).where(and(eq(interviews.userId, userId), eq(interviews.id, id)));
  } else if (createdId) {
    await db.delete(interviews).where(and(eq(interviews.userId, userId), eq(interviews.id, createdId)));
  }
}

export async function upsertInterview(ctx: ServiceCtx, input: UpsertInterviewInput): Promise<Interview> {
  const values = Object.fromEntries(Object.entries(input).filter(([k, v]) => k !== "id" && v !== undefined));
  if (input.id) {
    const [row] = await db
      .update(interviews)
      .set(values)
      .where(and(eq(interviews.userId, ctx.userId), eq(interviews.id, input.id)))
      .returning();
    if (!row) throw new NotFoundError("Interview not found.");
    return row;
  }
  if (!input.scheduledAt) throw new NotFoundError("An interview needs a date and time.");
  const [row] = await db
    .insert(interviews)
    .values({ userId: ctx.userId, scheduledAt: input.scheduledAt, ...values })
    .returning();
  return row;
}

export async function listQuestions(userId: string, opts: { unpracticedOnly?: boolean } = {}): Promise<PrepQuestion[]> {
  const where = [eq(prepQuestions.userId, userId)];
  if (opts.unpracticedOnly) where.push(isNull(prepQuestions.practicedAt));
  return db
    .select()
    .from(prepQuestions)
    .where(and(...where))
    .orderBy(asc(prepQuestions.category), desc(prepQuestions.createdAt));
}

export async function addQuestion(ctx: ServiceCtx, input: { question: string; category?: string | null }): Promise<PrepQuestion> {
  const [row] = await db
    .insert(prepQuestions)
    .values({ userId: ctx.userId, question: input.question, category: input.category ?? null })
    .returning();
  return row;
}

export async function setPracticed(ctx: ServiceCtx, id: string, practiced: boolean): Promise<PrepQuestion> {
  const [row] = await db
    .update(prepQuestions)
    .set({ practicedAt: practiced ? nowOf(ctx) : null })
    .where(and(eq(prepQuestions.userId, ctx.userId), eq(prepQuestions.id, id)))
    .returning();
  if (!row) throw new NotFoundError("Question not found.");
  return row;
}

export async function listStories(userId: string): Promise<Story[]> {
  return db.select().from(stories).where(eq(stories.userId, userId));
}

export async function saveStory(ctx: ServiceCtx, kind: StoryKind, bodyMd: string): Promise<Story> {
  const [row] = await db
    .insert(stories)
    .values({ userId: ctx.userId, kind, bodyMd })
    .onConflictDoUpdate({ target: [stories.userId, stories.kind], set: { bodyMd, updatedAt: nowOf(ctx) } })
    .returning();
  return row;
}

export async function logPrepSession(ctx: ServiceCtx, note?: string) {
  return logActivity(ctx, { type: "prep_session", groupKind: "prep", refType: note ? "note" : undefined, refId: note });
}
