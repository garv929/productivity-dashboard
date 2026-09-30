import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { googleConnectionStatus } from "@/lib/calendar";
import { todoistHealthy } from "@/lib/todoist";

export const dynamic = "force-dynamic";

async function dbHealthy(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** Public connectivity probe for deploy checks; returns booleans only, no data. */
export async function GET() {
  const [dbOk, todoistOk, session] = await Promise.all([dbHealthy(), todoistHealthy(), auth().catch(() => null)]);
  let google: boolean | "needs-login" = "needs-login";
  if (dbOk && session?.user?.id) {
    const status = await googleConnectionStatus(session.user.id).catch(() => "error" as const);
    google = status === "ok" ? true : status === "needs-login" ? "needs-login" : false;
  }
  const ok = dbOk && todoistOk;
  return Response.json({ ok, db: dbOk, todoist: todoistOk, google }, { status: ok ? 200 : 503 });
}
