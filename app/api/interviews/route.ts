import { z } from "zod";
import { withOwner } from "@/lib/auth-guard";
import { getInterviewWeek } from "@/lib/services/interview-week";

export const dynamic = "force-dynamic";

/** One week of interviews for the homepage timeline (`?week=` any date in that week). */
export const GET = withOwner(async (req, owner) => {
  const week = z.iso.date().optional().parse(new URL(req.url).searchParams.get("week") ?? undefined);
  return Response.json(await getInterviewWeek(owner.userId, week));
});
