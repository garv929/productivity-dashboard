import { z } from "zod";
import { withOwner } from "@/lib/auth-guard";
import { actions } from "@/lib/ai/executor";

export const dynamic = "force-dynamic";

export const POST = withOwner<{ params: Promise<{ id: string }> }>(async (_req, owner, { params }) => {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "Not found" }, { status: 404 });
  const res = await actions.cancel(owner.userId, id.data);
  return res.ok ? Response.json({ ok: true }) : Response.json({ ok: false, reason: res.reason }, { status: 409 });
});
