import { z } from "zod";
import { withOwner } from "@/lib/auth-guard";
import { getWeekAgenda } from "@/lib/services/agenda";

export const dynamic = "force-dynamic";

export const GET = withOwner(async (req, owner) => {
  const week = z.iso.date().optional().parse(new URL(req.url).searchParams.get("week") ?? undefined);
  return Response.json(await getWeekAgenda(owner.userId, week));
});
