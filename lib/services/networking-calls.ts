import "server-only";
import { and, asc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, networkingCalls, type NetworkingCall } from "@/lib/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ServiceCtx } from "./context";

/** Calls from 2 hours ago onwards count as upcoming, so one that just started still shows. */
const UPCOMING_GRACE_MS = 2 * 3600_000;

export async function listNetworkingCalls(
  userId: string,
  opts: { upcomingOnly?: boolean; now?: Date; from?: Date; to?: Date } = {},
): Promise<NetworkingCall[]> {
  const where: SQL[] = [eq(networkingCalls.userId, userId)];
  if (opts.upcomingOnly) where.push(gte(networkingCalls.scheduledAt, new Date((opts.now ?? new Date()).getTime() - UPCOMING_GRACE_MS)));
  if (opts.from) where.push(gte(networkingCalls.scheduledAt, opts.from));
  if (opts.to) where.push(lt(networkingCalls.scheduledAt, opts.to));
  return db.select().from(networkingCalls).where(and(...where)).orderBy(asc(networkingCalls.scheduledAt));
}

export async function getNetworkingCall(userId: string, id: string): Promise<NetworkingCall> {
  const [row] = await db
    .select()
    .from(networkingCalls)
    .where(and(eq(networkingCalls.userId, userId), eq(networkingCalls.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError("Networking call not found.");
  return row;
}

/** A contact with exactly this name (case-insensitive), to link the call to. */
async function findContactByName(userId: string, name: string) {
  const [row] = await db
    .select({ id: contacts.id, company: contacts.company })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), sql`lower(trim(${contacts.name})) = ${name.trim().toLowerCase()}`))
    .limit(1);
  return row ?? null;
}

export type UpsertNetworkingCallInput = {
  id?: string;
  personName?: string;
  company?: string | null;
  scheduledAt?: Date;
  notes?: string | null;
};

export type UpsertNetworkingCallResult = { call: NetworkingCall; previous: NetworkingCall | null };

/**
 * Create or update. The call links to a contact with the same name when there is one,
 * and borrows that contact's company if none was given.
 */
export async function upsertNetworkingCall(ctx: ServiceCtx, input: UpsertNetworkingCallInput): Promise<UpsertNetworkingCallResult> {
  const previous = input.id ? await getNetworkingCall(ctx.userId, input.id) : null;
  if (!previous && !input.personName?.trim()) throw new ValidationError("Say who the call is with.");
  if (!previous && !input.scheduledAt) throw new ValidationError("A networking call needs a date and time.");

  const values: Partial<typeof networkingCalls.$inferInsert> = {};
  if (input.personName !== undefined) {
    const name = input.personName.trim();
    const contact = await findContactByName(ctx.userId, name);
    values.personName = name;
    values.contactId = contact?.id ?? null;
    if (input.company === undefined && contact?.company && !previous?.company) values.company = contact.company;
  }
  if (input.company !== undefined) values.company = input.company?.trim() || null;
  if (input.scheduledAt !== undefined) values.scheduledAt = input.scheduledAt;
  if (input.notes !== undefined) values.notes = input.notes?.trim() || null;

  if (previous) {
    if (Object.keys(values).length === 0) return { call: previous, previous };
    const [call] = await db
      .update(networkingCalls)
      .set(values)
      .where(and(eq(networkingCalls.userId, ctx.userId), eq(networkingCalls.id, previous.id)))
      .returning();
    return { call, previous };
  }
  const [call] = await db
    .insert(networkingCalls)
    .values({ userId: ctx.userId, personName: values.personName!, scheduledAt: values.scheduledAt!, ...values })
    .returning();
  return { call, previous: null };
}

export async function deleteNetworkingCall(ctx: ServiceCtx, id: string): Promise<void> {
  const rows = await db
    .delete(networkingCalls)
    .where(and(eq(networkingCalls.userId, ctx.userId), eq(networkingCalls.id, id)))
    .returning({ id: networkingCalls.id });
  if (!rows.length) throw new NotFoundError("Networking call not found.");
}

/** Undo helper: put back a previous snapshot, or remove a call created in the same action. */
export async function restoreNetworkingCall(userId: string, snapshot: NetworkingCall | null, createdId?: string) {
  if (snapshot) {
    const { id, userId: _u, createdAt: _c, ...rest } = snapshot;
    void _u;
    void _c;
    await db.update(networkingCalls).set(rest).where(and(eq(networkingCalls.userId, userId), eq(networkingCalls.id, id)));
  } else if (createdId) {
    await db.delete(networkingCalls).where(and(eq(networkingCalls.userId, userId), eq(networkingCalls.id, createdId)));
  }
}
