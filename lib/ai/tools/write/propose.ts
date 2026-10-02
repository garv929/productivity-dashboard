import "server-only";
import { propose, type ActionStep } from "@/lib/ai/pending-actions";
import { pendingRepo } from "@/lib/ai/pending-repo";
import type { ProposalOutput } from "@/lib/ai/types";
import { fail, withTurnLock, type ToolCtx } from "../context";

/**
 * Stores steps as (part of) this turn's pending action and returns the preview.
 * Nothing is written to Todoist or the database until the user confirms.
 */
export async function proposeSteps(tc: ToolCtx, build: () => Promise<ActionStep[] | { error: string }>): Promise<ProposalOutput> {
  try {
    const built = await build();
    if (!Array.isArray(built)) return built;
    return await withTurnLock(tc, async () => {
      const record = await propose(pendingRepo, () => new Date(), {
        userId: tc.userId,
        chatSessionId: tc.chatSessionId,
        turnId: tc.turnId,
        existingId: tc.turn.pendingId,
        steps: built,
      });
      tc.turn.pendingId = record.id;
      return {
        pendingActionId: record.id,
        status: "awaiting_confirmation" as const,
        steps: record.steps.map((s) => ({ tool: s.tool, summary: s.summary, details: s.details })),
        instruction:
          "NOT EXECUTED YET. The UI shows a confirmation card with every step of this pending action. Summarise all steps in one clear sentence ending with “Proceed?” and stop. Do not claim anything was done.",
      };
    });
  } catch (err) {
    return fail(err);
  }
}
