export class AppError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/** A write targeted something outside the active groups' Todoist projects/sections. */
export class ScopeError extends AppError {
  constructor(message = "That Todoist location isn't mapped to an active group, so it's read-only here.") {
    super("ScopeError", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super("NotFoundError", message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("ValidationError", message);
  }
}

export class TodoistRateLimitError extends AppError {
  constructor(public retryAfter: number) {
    super("TodoistRateLimitError", `Todoist is rate-limiting requests; retry in ${retryAfter}s.`);
  }
}

export class FocusLimitError extends AppError {
  constructor() {
    super("FocusLimitError", "Finish or drop one first: only 2 Personal Development items can be active.");
  }
}

export class CapExceededError extends AppError {
  constructor(public logged: number, public cap: number) {
    super(
      "CapExceededError",
      `That would put side-income hours at ${logged}h this week, over the ${cap}h cap. Confirm the override explicitly to log it anyway.`,
    );
  }
}

export class GoogleAuthError extends AppError {
  constructor(message = "Google Calendar needs to be re-connected. Sign out and sign in again.") {
    super("GoogleAuthError", message);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
