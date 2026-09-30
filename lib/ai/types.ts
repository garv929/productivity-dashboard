/** Client-safe shapes shared by the assistant API routes and the chat UI. */

export type PendingStatus = "awaiting_confirmation" | "executing" | "executed" | "failed" | "cancelled" | "expired";

export type StepPreview = { tool: string; summary: string };

export type StepResultView = {
  index: number;
  tool: string;
  ok: boolean;
  summary: string;
  error?: string;
  undoable: boolean;
};

export type PendingActionView = {
  id: string;
  status: PendingStatus;
  steps: StepPreview[];
  results: StepResultView[];
  failedIndex: number | null;
  error: string | null;
  stale: boolean;
  undone: boolean;
  expiresAt: string;
};

/** What a write tool returns to the model (and what the UI reads off the tool part). */
export type ProposalOutput =
  | {
      pendingActionId: string;
      status: "awaiting_confirmation";
      steps: StepPreview[];
      instruction: string;
    }
  | { error: string };

export type ChatPageContext = { pathname: string; groupSlug: string | null };

export const WRITE_TOOL_NAMES = [
  "create_tasks",
  "update_task",
  "reschedule_tasks",
  "complete_tasks",
  "move_task",
  "upsert_application",
  "upsert_contact",
  "log_touch",
  "upsert_company",
  "upsert_side_income_option",
  "log_side_income_hours",
  "set_focus_item_status",
  "save_weekly_review",
] as const;

export const TOOL_STATUS: Record<string, string> = {
  list_groups: "Looking at your groups",
  get_tasks: "Checking tasks",
  get_next_step: "Working out the next step",
  get_calendar_blocks: "Reading your calendar",
  get_current_block: "Checking what's on now",
  get_applications: "Checking your applications",
  get_contacts: "Checking your contacts",
  get_companies: "Checking target companies",
  get_interviews_and_prep: "Checking interview prep",
  get_side_income_options: "Checking side-income options",
  get_focus_items: "Checking focus items",
  get_scorecard: "Checking this week's scorecard",
  search: "Searching",
  create_tasks: "Drafting new tasks",
  update_task: "Drafting a task edit",
  reschedule_tasks: "Drafting new dates",
  complete_tasks: "Drafting completions",
  move_task: "Drafting a move",
  upsert_application: "Drafting an application update",
  upsert_contact: "Drafting a contact update",
  log_touch: "Drafting a contact log",
  upsert_company: "Drafting a company update",
  upsert_side_income_option: "Drafting an income-option update",
  log_side_income_hours: "Drafting an hours log",
  set_focus_item_status: "Drafting a focus change",
  save_weekly_review: "Drafting your weekly review",
  confirm_pending_action: "Running the confirmed changes",
  cancel_pending_action: "Cancelling",
};
