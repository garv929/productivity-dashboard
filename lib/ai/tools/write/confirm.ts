import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actions } from "@/lib/ai/executor";
import { isAffirmative, toView } from "@/lib/ai/pending-actions";
import { fail, type ToolCtx } from "../context";

export function confirmTools(tc: ToolCtx) {
  return {
    confirm_pending_action: tool({
      description:
        "Execute a pending action ONLY when the user's latest message is an unambiguous yes (“yes”, “go ahead”, “do it”). The server double-checks the message. Never call it on your own initiative.",
      inputSchema: z.object({ pendingActionId: z.uuid() }),
      execute: async ({ pendingActionId }) => {
        if (!isAffirmative(tc.lastUserText)) {
          return { error: "The user's last message isn't an explicit confirmation. Ask them to confirm (card button or “yes”)." };
        }
        try {
          const res = await actions.confirm(tc.userId, pendingActionId);
          if (res.outcome === "rejected") return { outcome: "rejected", reason: res.reason };
          revalidatePath("/", "layout");
          const view = toView(res.record);
          if (res.outcome === "stale") {
            return { outcome: "stale", reason: res.reason, instruction: "Explain what changed, re-read the data, and propose an updated action." };
          }
          return {
            outcome: res.outcome,
            results: view.results.map((r) => ({ ok: r.ok, summary: r.summary, error: r.error })),
            ...(res.outcome === "failed"
              ? { instruction: "Report which steps succeeded and which failed (in plain language), and offer to retry the rest or pick an alternative. The card offers Retry and Undo." }
              : {}),
          };
        } catch (err) {
          return fail(err);
        }
      },
    }),

    cancel_pending_action: tool({
      description: "Cancel a pending action when the user says no / cancel / never mind.",
      inputSchema: z.object({ pendingActionId: z.uuid() }),
      execute: async ({ pendingActionId }) => {
        try {
          const res = await actions.cancel(tc.userId, pendingActionId);
          return res.ok ? { outcome: "cancelled" } : { outcome: "rejected", reason: res.reason };
        } catch (err) {
          return fail(err);
        }
      },
    }),
  };
}
