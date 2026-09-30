import "server-only";
import { and, eq, ilike, lt, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, type Contact, type ContactRelationship } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";
import { logActivity } from "./activity";
import { nowOf, type ServiceCtx } from "./context";

export const RELATIONSHIPS: ContactRelationship[] = ["friend", "ex_colleague", "recruiter", "cold"];
export const RELATIONSHIP_LABEL: Record<ContactRelationship, string> = {
  friend: "Friend",
  ex_colleague: "Ex-colleague",
  recruiter: "Recruiter",
  cold: "Cold",
};

export type TouchType = "outreach" | "follow_up" | "conversation";

const DEFAULT_CHECK_IN_DAYS: Record<TouchType, number> = { outreach: 7, follow_up: 7, conversation: 14 };

export type ContactFilter = { overdueOnly?: boolean; company?: string; name?: string; now?: Date };

/** Overdue check-ins first (oldest first), then soonest check-in, then name. */
export function sortContacts(list: Contact[], now: Date): Contact[] {
  const t = now.getTime();
  return [...list].sort((a, b) => {
    const ao = a.nextCheckInAt ? a.nextCheckInAt.getTime() < t : false;
    const bo = b.nextCheckInAt ? b.nextCheckInAt.getTime() < t : false;
    if (ao !== bo) return ao ? -1 : 1;
    const an = a.nextCheckInAt?.getTime() ?? Infinity;
    const bn = b.nextCheckInAt?.getTime() ?? Infinity;
    if (an !== bn) return an - bn;
    return a.name.localeCompare(b.name);
  });
}

export async function listContacts(userId: string, f: ContactFilter = {}): Promise<Contact[]> {
  const now = f.now ?? new Date();
  const where: SQL[] = [eq(contacts.userId, userId)];
  if (f.overdueOnly) where.push(lt(contacts.nextCheckInAt, now));
  if (f.company) where.push(ilike(contacts.company, `%${f.company}%`));
  if (f.name) where.push(or(ilike(contacts.name, `%${f.name}%`))!);
  const rows = await db.select().from(contacts).where(and(...where));
  return sortContacts(rows, now);
}

export async function getContact(userId: string, id: string): Promise<Contact> {
  const [row] = await db.select().from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.id, id))).limit(1);
  if (!row) throw new NotFoundError("Contact not found.");
  return row;
}

export type UpsertContactInput = {
  id?: string;
  name?: string;
  company?: string | null;
  relationship?: ContactRelationship;
  channel?: string | null;
  nextCheckInAt?: Date | null;
  lastContactAt?: Date | null;
  notes?: string | null;
};

export async function upsertContact(ctx: ServiceCtx, input: UpsertContactInput): Promise<{ contact: Contact; previous: Contact | null }> {
  const previous = input.id ? await getContact(ctx.userId, input.id) : null;
  const values = Object.fromEntries(
    Object.entries({
      name: input.name,
      company: input.company,
      relationship: input.relationship,
      channel: input.channel,
      nextCheckInAt: input.nextCheckInAt,
      lastContactAt: input.lastContactAt,
      notes: input.notes,
    }).filter(([, v]) => v !== undefined),
  );
  if (previous) {
    const [contact] = await db
      .update(contacts)
      .set(values)
      .where(and(eq(contacts.userId, ctx.userId), eq(contacts.id, previous.id)))
      .returning();
    return { contact, previous };
  }
  if (!input.name) throw new NotFoundError("A new contact needs a name.");
  const [contact] = await db
    .insert(contacts)
    .values({ userId: ctx.userId, name: input.name, ...values })
    .returning();
  return { contact, previous: null };
}

export type LogTouchInput = { contactId: string; type: TouchType; nextCheckInAt?: Date | null; note?: string };

export async function logTouch(ctx: ServiceCtx, input: LogTouchInput) {
  const previous = await getContact(ctx.userId, input.contactId);
  const now = nowOf(ctx);
  const nextCheckInAt =
    input.nextCheckInAt ?? new Date(now.getTime() + DEFAULT_CHECK_IN_DAYS[input.type] * 86_400_000);
  const notes = input.note
    ? [previous.notes, `${now.toISOString().slice(0, 10)} ${input.type.replace("_", "-")}: ${input.note}`]
        .filter(Boolean)
        .join("\n")
    : previous.notes;
  const [contact] = await db
    .update(contacts)
    .set({ lastContactAt: now, nextCheckInAt, notes })
    .where(and(eq(contacts.userId, ctx.userId), eq(contacts.id, previous.id)))
    .returning();
  const activity = await logActivity(ctx, {
    type: input.type,
    groupKind: "people",
    refType: "contact",
    refId: contact.id,
  });
  return { contact, previous, activityId: activity.id };
}

export async function restoreContact(userId: string, snapshot: Contact | null, createdId?: string) {
  if (snapshot) {
    const { id, userId: _u, createdAt: _c, updatedAt: _up, ...rest } = snapshot;
    void _u;
    void _c;
    void _up;
    await db.update(contacts).set(rest).where(and(eq(contacts.userId, userId), eq(contacts.id, id)));
  } else if (createdId) {
    await db.delete(contacts).where(and(eq(contacts.userId, userId), eq(contacts.id, createdId)));
  }
}
