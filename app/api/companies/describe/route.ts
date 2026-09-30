import { z } from "zod";
import { withOwner } from "@/lib/auth-guard";
import { describeCompany } from "@/lib/services/company-lookup";

export const dynamic = "force-dynamic";

export const GET = withOwner(async (req) => {
  const domain = z.string().min(1).max(253).parse(new URL(req.url).searchParams.get("domain"));
  return Response.json(await describeCompany(domain));
});
