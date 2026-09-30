"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { run } from "./_run";
import {
  createGroup,
  groupInputSchema,
  reorderGroups,
  setGroupArchived,
  updateGroup,
  type GroupInput,
} from "@/lib/services/groups-admin";
import { revalidateTodoist } from "@/lib/todoist";

export async function saveGroupAction(id: string | null, input: GroupInput) {
  return run(async (ctx) => {
    const data = groupInputSchema.parse(input);
    const g = id ? await updateGroup(ctx.userId, z.uuid().parse(id), data) : await createGroup(ctx.userId, data);
    revalidateTodoist();
    revalidatePath("/", "layout");
    return { id: g.id, slug: g.slug };
  });
}

export async function archiveGroupAction(id: string, archived: boolean) {
  return run(async (ctx) => {
    await setGroupArchived(ctx.userId, z.uuid().parse(id), archived);
    revalidatePath("/", "layout");
    return null;
  });
}

export async function reorderGroupsAction(ids: string[]) {
  return run(async (ctx) => {
    await reorderGroups(ctx.userId, z.array(z.uuid()).max(50).parse(ids));
    revalidatePath("/", "layout");
    return null;
  });
}
