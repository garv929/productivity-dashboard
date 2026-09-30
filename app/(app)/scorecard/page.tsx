import { requireOwnerPage } from "@/lib/auth-guard";
import { getScorecard } from "@/lib/services/dashboard";
import { getTargets } from "@/lib/services/targets";
import { mondayOf } from "@/lib/domain/time";
import { ScorecardView } from "@/components/scorecard/scorecard-view";
import { ErrorState } from "@/components/states";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scorecard" };

export default async function ScorecardPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const owner = await requireOwnerPage();
  const weekStart = week && /^\d{4}-\d{2}-\d{2}$/.test(week) && !Number.isNaN(Date.parse(week)) ? mondayOf(week) : undefined;
  const loaded = await (async () => {
    const data = await getScorecard(owner.userId, weekStart);
    const targets = await getTargets(owner.userId, data.weekStart);
    return { data, overridden: Object.values(targets).some((t) => t.overridden) };
  })().catch((err: unknown) => ({ error: err }));
  if ("error" in loaded) return <ErrorState error={loaded.error} />;
  return <ScorecardView data={loaded.data} hasOverrides={loaded.overridden} />;
}
