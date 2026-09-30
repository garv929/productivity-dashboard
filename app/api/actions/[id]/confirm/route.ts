import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withOwner } from "@/lib/auth-guard";
import { actions } from "@/lib/ai/executor";
import { toView } from "@/lib/ai/pending-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The only way an assistant proposal executes: session + awaiting status + unexpired, claimed atomically. */
export const POST = withOwner<{ params: Promise<{ id: string }> }>(async (_req, owner, { params }) => {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "Not found" }, { status: 404 });
  const res = await actions.confirm(owner.userId, id.data);
  if (res.outcome === "rejected") {
    return Response.json({ outcome: "rejected", reason: res.reason, status: res.status }, { status: res.status === "not_found" ? 404 : 409 });
  }
  revalidatePath("/", "layout");
  return Response.json({
    outcome: res.outcome,
    ...(res.outcome === "stale" ? { reason: res.reason } : {}),
    action: toView(res.record),
  });
});
