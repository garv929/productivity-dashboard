import { requireOwnerPage } from "@/lib/auth-guard";
import { listGroups } from "@/lib/domain/groups";
import { getDefaultTargets } from "@/lib/services/targets";
import { todoistHealthy } from "@/lib/todoist";
import { googleConnectionStatus } from "@/lib/calendar";
import { METRICS } from "@/lib/domain/scorecard";
import { SettingsView } from "@/components/settings/settings-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const owner = await requireOwnerPage();
  const [groups, targets, todoist, google] = await Promise.all([
    listGroups(owner.userId),
    getDefaultTargets(owner.userId),
    todoistHealthy(),
    googleConnectionStatus(owner.userId).catch(() => "error" as const),
  ]);
  return (
    <SettingsView
      email={owner.email}
      groups={groups.map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        kind: g.kind,
        color: g.color,
        icon: g.icon,
        todoistProjectId: g.todoistProjectId,
        todoistSectionId: g.todoistSectionId,
        calendarMatch: g.calendarMatch,
        archived: Boolean(g.archivedAt),
      }))}
      targets={METRICS.map((m) => ({ metric: m.key, label: m.label, isCap: Boolean(m.isCap), unit: m.unit, min: targets[m.key].min, max: targets[m.key].max }))}
      status={{ todoist, google }}
    />
  );
}
