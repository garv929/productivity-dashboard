import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { groupKind, groups, type Group } from "@/lib/db/schema";
import { ValidationError } from "@/lib/errors";

export const calendarRuleSchema = z.object({
  type: z.enum(["equals", "startsWith", "contains"]),
  value: z.string().trim().min(1).max(200),
});

export const groupInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes"),
  kind: z.enum(groupKind.enumValues),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #3F51B5"),
  icon: z.string().trim().min(1).max(40),
  todoistProjectId: z.string().trim().min(1).nullable(),
  todoistSectionId: z.string().trim().min(1).nullable(),
  calendarMatch: z.array(calendarRuleSchema).max(20),
});

export type GroupInput = z.infer<typeof groupInputSchema>;

async function assertSlugFree(userId: string, slug: string, exceptId?: string) {
  const where = exceptId
    ? and(eq(groups.userId, userId), eq(groups.slug, slug), ne(groups.id, exceptId))
    : and(eq(groups.userId, userId), eq(groups.slug, slug));
  const [clash] = await db.select({ id: groups.id }).from(groups).where(where).limit(1);
  if (clash) throw new ValidationError(`Another group already uses the slug "${slug}".`);
}

export async function createGroup(userId: string, input: GroupInput): Promise<Group> {
  const data = groupInputSchema.parse(input);
  await assertSlugFree(userId, data.slug);
  const existing = await db.select({ sortOrder: groups.sortOrder }).from(groups).where(eq(groups.userId, userId));
  const sortOrder = existing.reduce((m, g) => Math.max(m, g.sortOrder), -1) + 1;
  const [row] = await db.insert(groups).values({ userId, ...data, sortOrder }).returning();
  return row;
}

export async function updateGroup(userId: string, id: string, input: GroupInput): Promise<Group> {
  const data = groupInputSchema.parse(input);
  await assertSlugFree(userId, data.slug, id);
  const [row] = await db
    .update(groups)
    .set(data)
    .where(and(eq(groups.userId, userId), eq(groups.id, id)))
    .returning();
  if (!row) throw new ValidationError("Group not found.");
  return row;
}

export async function setGroupArchived(userId: string, id: string, archived: boolean): Promise<void> {
  await db
    .update(groups)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(groups.userId, userId), eq(groups.id, id)));
}

/** Rewrites sort_order to match the given id order. */
export async function reorderGroups(userId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [i, id] of orderedIds.entries()) {
      await tx.update(groups).set({ sortOrder: i }).where(and(eq(groups.userId, userId), eq(groups.id, id)));
    }
  });
}
