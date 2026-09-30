import { z } from "zod";
import { withOwner } from "@/lib/auth-guard";
import { getGroupPageData } from "@/lib/services/dashboard";

export const dynamic = "force-dynamic";

export const GET = withOwner(async (req, owner) => {
  const slug = z.string().min(1).max(40).parse(new URL(req.url).searchParams.get("group"));
  const data = await getGroupPageData(owner.userId, slug);
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(data);
});
