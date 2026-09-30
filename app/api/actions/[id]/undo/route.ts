import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withOwner } from "@/lib/auth-guard";
import { actions } from "@/lib/ai/executor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withOwner<{ params: Promise<{ id: string }> }>(async (_req, owner, { params }) => {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "Not found" }, { status: 404 });
  const res = await actions.undo(owner.userId, id.data);
  if (!res.ok) return Response.json(res, { status: 409 });
  revalidatePath("/", "layout");
  return Response.json(res);
});
