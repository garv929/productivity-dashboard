import { withOwner } from "@/lib/auth-guard";
import { getOverview } from "@/lib/services/dashboard";

export const dynamic = "force-dynamic";

export const GET = withOwner(async (_req, owner) => Response.json(await getOverview(owner.userId)));
