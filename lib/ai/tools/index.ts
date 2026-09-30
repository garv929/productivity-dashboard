import "server-only";
import type { ToolCtx } from "./context";
import { taskReadTools } from "./read/tasks";
import { calendarReadTools } from "./read/calendar";
import { recordReadTools } from "./read/records";
import { searchTool } from "./read/search";
import { taskWriteTools } from "./write/tasks";
import { recordWriteTools } from "./write/records";
import { confirmTools } from "./write/confirm";

export function buildTools(tc: ToolCtx) {
  return {
    ...taskReadTools(tc),
    ...calendarReadTools(tc),
    ...recordReadTools(tc),
    ...searchTool(tc),
    ...taskWriteTools(tc),
    ...recordWriteTools(tc),
    ...confirmTools(tc),
  };
}

export type AssistantTools = ReturnType<typeof buildTools>;
