import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/lib/auth-guard";
import { getGroupPageData } from "@/lib/services/dashboard";
import { loadPanel } from "@/lib/services/panels";
import { GroupView } from "@/components/group/group-view";
import { ContextPanel } from "@/components/panels/context-panel";
import { ErrorState } from "@/components/states";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) };
}

export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const owner = await requireOwnerPage();
  let data;
  try {
    data = await getGroupPageData(owner.userId, slug);
  } catch (err) {
    return <ErrorState error={err} />;
  }
  if (!data) notFound();
  const panel = await loadPanel(owner.userId, data.group.kind);
  return (
    <GroupView initial={data}>
      <ContextPanel data={panel} readOnly={data.group.archived} groupColor={data.group.color} />
    </GroupView>
  );
}
