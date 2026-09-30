import { requireOwnerPage } from "@/lib/auth-guard";
import { listActiveGroups } from "@/lib/domain/groups";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireOwnerPage();
  const groups = await listActiveGroups(owner.userId);
  return (
    <AppShell
      email={owner.email}
      groups={groups.map((g) => ({ slug: g.slug, name: g.name, color: g.color, icon: g.icon }))}
    >
      {children}
    </AppShell>
  );
}
