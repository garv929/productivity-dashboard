import { z } from "zod";
import { withOwner } from "@/lib/auth-guard";
import { actions } from "@/lib/ai/executor";
import { toView } from "@/lib/ai/pending-actions";

export const dynamic = "force-dynamic";

export const GET = withOwner<{ params: Promise<{ id: string }> }>(async (_req, owner, { params }) => {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "Not found" }, { status: 404 });
  const row = await actions.get(owner.userId, id.data);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  const view = toView(row);
  if (view.status === "awaiting_confirmation" && new Date(view.expiresAt).getTime() <= Date.now()) view.status = "expired";
  return Response.json(view);
});
