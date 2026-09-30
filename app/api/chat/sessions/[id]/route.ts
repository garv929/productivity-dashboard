import { withOwner } from "@/lib/auth-guard";
import { deleteSession, getSession, loadMessages } from "@/lib/ai/chat-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withOwner<Ctx>(async (_req, owner, { params }) => {
  const { id } = await params;
  const session = await getSession(owner.userId, id);
  if (!session) return Response.json({ session: null, messages: [] });
  return Response.json({
    session: { id: session.id, title: session.title, updatedAt: session.updatedAt },
    messages: await loadMessages(owner.userId, id),
  });
});

export const DELETE = withOwner<Ctx>(async (_req, owner, { params }) => {
  const { id } = await params;
  await deleteSession(owner.userId, id);
  return Response.json({ ok: true });
});
