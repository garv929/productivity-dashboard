import { z } from "zod";
import { withOwner } from "@/lib/auth-guard";
import { suggestCompanies } from "@/lib/services/company-lookup";

export const dynamic = "force-dynamic";

export const GET = withOwner(async (req) => {
  const q = z.string().max(80).catch("").parse(new URL(req.url).searchParams.get("q"));
  return Response.json({ suggestions: await suggestCompanies(q) });
});
