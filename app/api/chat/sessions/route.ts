import { withOwner } from "@/lib/auth-guard";
import { listSessions } from "@/lib/ai/chat-store";

export const dynamic = "force-dynamic";

export const GET = withOwner(async (_req, owner) => Response.json({ sessions: await listSessions(owner.userId) }));
