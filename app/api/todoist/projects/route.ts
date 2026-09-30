import { withOwner } from "@/lib/auth-guard";
import { listProjects, listSections } from "@/lib/todoist";

export const dynamic = "force-dynamic";

export const GET = withOwner(async () => {
  const [projects, sections] = await Promise.all([listProjects(), listSections()]);
  return Response.json({ projects, sections });
});
