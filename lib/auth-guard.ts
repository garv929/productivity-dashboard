import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAllowedEmail } from "@/auth.config";

export type Owner = { userId: string; email: string };

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

async function currentOwner(): Promise<Owner | null> {
  const session = await auth();
  const email = session?.user?.email;
  const userId = session?.user?.id;
  if (!userId || !email || !isAllowedEmail(email)) return null;
  return { userId, email };
}

/** Server Actions and Route Handlers: throws if not the allowlisted owner. */
export async function requireOwner(): Promise<Owner> {
  const owner = await currentOwner();
  if (!owner) throw new UnauthorizedError();
  return owner;
}

/** Pages and layouts: redirects to /login if not the allowlisted owner. */
export async function requireOwnerPage(): Promise<Owner> {
  const owner = await currentOwner();
  if (!owner) redirect("/login");
  return owner;
}

/** Route Handler wrapper: session check + consistent JSON errors. */
export function withOwner<Ctx>(
  handler: (req: Request, owner: Owner, ctx: Ctx) => Promise<Response>,
) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const owner = await currentOwner();
    if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });
    try {
      return await handler(req, owner, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  const e = err as { name?: string; message?: string; status?: number; retryAfter?: number; code?: string };
  if (e?.name === "TodoistRateLimitError") {
    return Response.json(
      { error: "rate_limited", message: "Todoist is rate-limiting, retrying…", retryAfter: e.retryAfter },
      { status: 429, headers: { "Retry-After": String(e.retryAfter ?? 5) } },
    );
  }
  if (e?.name === "ScopeError") return Response.json({ error: "out_of_scope", message: e.message }, { status: 403 });
  if (e?.name === "NotFoundError") return Response.json({ error: "not_found", message: e.message }, { status: 404 });
  if (e?.name === "ValidationError" || e?.name === "ZodError")
    return Response.json({ error: "invalid", message: e.message }, { status: 400 });
  console.error(err);
  return Response.json({ error: "server_error", message: e?.message ?? "Unexpected error" }, { status: 500 });
}
