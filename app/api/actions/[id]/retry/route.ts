import { z } from "zod";
import { withOwner } from "@/lib/auth-guard";
import { actions } from "@/lib/ai/executor";
import { toView } from "@/lib/ai/pending-actions";

export const dynamic = "force-dynamic";

/** Creates a fresh proposal for the steps that didn't run; it still needs its own confirmation. */
export const POST = withOwner<{ params: Promise<{ id: string }> }>(async (_req, owner, { params }) => {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "Not found" }, { status: 404 });
  const res = await actions.retry(owner.userId, id.data);
  if (!res.ok) return Response.json(res, { status: 409 });
  return Response.json({ ok: true, action: toView(res.record) });
});
