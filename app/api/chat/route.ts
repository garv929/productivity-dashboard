import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { requireOwner, UnauthorizedError } from "@/lib/auth-guard";
import { env } from "@/lib/env";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { buildTools } from "@/lib/ai/tools";
import { createToolCtx } from "@/lib/ai/tools/context";
import { recentActionsForSession } from "@/lib/ai/pending-repo";
import {
  ensureSession,
  loadMessages,
  messageText,
  RATE_LIMIT,
  recentUserMessageCount,
  saveMessages,
  summarizeIfNeeded,
} from "@/lib/ai/chat-store";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  id: z.string().min(8).max(100),
  message: z.object({
    id: z.string().min(1).max(100),
    role: z.literal("user"),
    parts: z.array(z.object({ type: z.string() }).passthrough()).min(1).max(20),
    metadata: z.unknown().optional(),
  }),
  page: z
    .object({
      pathname: z.string().max(200),
      groupSlug: z.string().max(60).nullable(),
    })
    .default({ pathname: "/", groupSlug: null }),
});

const json = (status: number, error: string, headers?: HeadersInit) => Response.json({ error }, { status, headers });

/** Keep only parts the model can consume; drop half-finished tool calls from aborted turns. */
function forModel(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((m) => ({
      ...m,
      parts: m.parts.filter((p) => {
        if (p.type === "text") return p.text.trim().length > 0;
        if (p.type.startsWith("tool-")) return "state" in p && (p.state === "output-available" || p.state === "output-error");
        return false;
      }),
    }))
    .filter((m) => m.parts.length > 0);
}

export async function POST(req: Request) {
  let owner;
  try {
    owner = await requireOwner();
  } catch (err) {
    if (err instanceof UnauthorizedError) return json(401, "Sign in required.");
    throw err;
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, "Invalid chat request.");
  const { id: sessionId, page } = parsed.data;
  const message = parsed.data.message as unknown as UIMessage;
  const text = messageText(message);
  if (!text) return json(400, "Empty message.");
  if (text.length > 8000) return json(400, "That message is too long.");

  if ((await recentUserMessageCount(owner.userId)) >= RATE_LIMIT.max) {
    return json(429, "You're sending messages quickly. Give it a few minutes and try again.", { "Retry-After": "60" });
  }

  const session = await ensureSession(owner.userId, sessionId, text);
  if (!session) return json(404, "Chat not found.");

  const history = await loadMessages(owner.userId, sessionId);
  const idx = history.findIndex((m) => m.id === message.id);
  const all = idx >= 0 ? [...history.slice(0, idx), message] : [...history, message];
  await saveMessages(owner.userId, sessionId, all);

  const now = new Date();
  const tc = createToolCtx({
    userId: owner.userId,
    tz: env.APP_TIMEZONE,
    now,
    chatSessionId: sessionId,
    turnId: crypto.randomUUID(),
    lastUserText: text,
    page,
  });
  const [groups, recentActions] = await Promise.all([tc.groups(), recentActionsForSession(owner.userId, sessionId)]);
  const tools = buildTools(tc);

  const instructions = buildSystemPrompt({ now, tz: tc.tz, page, groups, summary: session.summary, recentActions });
  const modelMessages = await convertToModelMessages(forModel(all.slice(session.summarizedCount)), {
    tools,
    ignoreIncompleteToolCalls: true,
  });

  const result = streamText({
    model: anthropic(env.ANTHROPIC_MODEL),
    instructions,
    messages: modelMessages,
    tools,
    stopWhen: isStepCount(8),
  });

  // Finish (and persist) even if the browser disconnects mid-stream.
  void result.consumeStream();

  const stream = toUIMessageStream({
    stream: result.stream,
    tools,
    originalMessages: all,
    generateMessageId: () => crypto.randomUUID(),
    onError: (err) => {
      console.error("[chat] stream error", err);
      const msg = err instanceof Error ? err.message : "";
      if (/rate.?limit|429|overloaded/i.test(msg)) return "The AI service is busy right now. Try again in a moment.";
      return "Something went wrong while answering. Please try again.";
    },
    onEnd: async ({ messages }) => {
      try {
        await saveMessages(owner.userId, sessionId, messages);
        await summarizeIfNeeded(session, messages);
      } catch (err) {
        console.error("[chat] persist failed", err);
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
