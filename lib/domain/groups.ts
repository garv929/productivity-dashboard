import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, type Group } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";

/** All groups (including archived), in sort order. */
export async function listGroups(userId: string): Promise<Group[]> {
  return db.select().from(groups).where(eq(groups.userId, userId)).orderBy(asc(groups.sortOrder), asc(groups.name));
}

export async function listActiveGroups(userId: string): Promise<Group[]> {
  return db
    .select()
    .from(groups)
    .where(and(eq(groups.userId, userId), isNull(groups.archivedAt)))
    .orderBy(asc(groups.sortOrder), asc(groups.name));
}

export async function getGroupBySlug(userId: string, slug: string): Promise<Group | null> {
  const [row] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.userId, userId), eq(groups.slug, slug)))
    .limit(1);
  return row ?? null;
}

export async function requireActiveGroup(userId: string, slug: string): Promise<Group> {
  const group = await getGroupBySlug(userId, slug);
  if (!group) throw new NotFoundError(`No group with slug "${slug}".`);
  if (group.archivedAt) throw new NotFoundError(`"${group.name}" is archived and read-only.`);
  return group;
}

export async function getGroupByKind(userId: string, kind: Group["kind"]): Promise<Group | null> {
  const [row] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.userId, userId), eq(groups.kind, kind), isNull(groups.archivedAt)))
    .orderBy(asc(groups.sortOrder))
    .limit(1);
  return row ?? null;
}
