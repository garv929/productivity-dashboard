export type ServiceCtx = {
  userId: string;
  source: "ui" | "assistant";
  tz: string;
  now?: Date;
};

export function nowOf(ctx: ServiceCtx): Date {
  return ctx.now ?? new Date();
}
