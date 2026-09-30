import { requireOwnerPage } from "@/lib/auth-guard";
import { getOverview } from "@/lib/services/dashboard";
import { HomeView } from "@/components/home/home-view";
import { ErrorState } from "@/components/states";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const owner = await requireOwnerPage();
  const overview = await getOverview(owner.userId).catch((err: unknown) => ({ error: err }));
  if ("error" in overview) return <ErrorState error={overview.error} />;
  return <HomeView initial={overview} />;
}
