"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, CheckCircle2, Loader2, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import type { CalendarMatchRule, GroupKind } from "@/lib/db/schema";
import type { MetricKey } from "@/lib/domain/scorecard";
import type { ProjectLite, SectionLite } from "@/lib/todoist/types";
import { archiveGroupAction, reorderGroupsAction, saveGroupAction } from "@/app/actions/groups";
import { saveTargetsAction } from "@/app/actions/records";
import { reconnectGoogleAction } from "@/app/actions/auth";
import { unwrap } from "@/lib/client/fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GROUP_ICONS, GroupIcon } from "@/components/group-icon";
import { ThemeSegmented } from "@/components/theme-toggle";
import { Field, NativeSelect, useAction } from "@/components/panels/shared";
import { cn } from "@/lib/utils";

export type SettingsGroup = {
  id: string;
  name: string;
  slug: string;
  kind: GroupKind;
  color: string;
  icon: string;
  todoistProjectId: string | null;
  todoistSectionId: string | null;
  calendarMatch: CalendarMatchRule[];
  archived: boolean;
};

type TargetSetting = { metric: MetricKey; label: string; isCap: boolean; unit: "count" | "hours"; min: number | null; max: number | null };
type TodoistMeta = { projects: ProjectLite[]; sections: SectionLite[] };

const KINDS: { value: GroupKind; label: string }[] = [
  { value: "pipeline", label: "Application pipeline" },
  { value: "people", label: "Contacts" },
  { value: "prep", label: "Interview prep" },
  { value: "research", label: "Target companies" },
  { value: "options", label: "Income options" },
  { value: "focus", label: "Focus items" },
  { value: "plain", label: "To-dos only" },
];

const RULE_TYPES: { value: CalendarMatchRule["type"]; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "startsWith", label: "starts with" },
  { value: "contains", label: "contains" },
];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function SettingsView({
  email,
  groups,
  targets,
  status,
}: {
  email: string;
  groups: SettingsGroup[];
  targets: TargetSetting[];
  status: { todoist: boolean; google: "ok" | "needs-login" | "error" };
}) {
  const todoist = useSWR<TodoistMeta>("/api/todoist/projects", { refreshInterval: 0 });
  return (
    <div className="space-y-10">
      <div>
        <p className="text-sm text-muted-foreground">Signed in as {email}</p>
        <h1 className="mt-1 text-3xl">Settings</h1>
      </div>

      <GroupsSection groups={groups} meta={todoist.data} metaLoading={todoist.isLoading} metaError={Boolean(todoist.error)} />
      <TargetsSection targets={targets} />
      <ConnectionsSection status={status} />

      <section>
        <h2 className="mb-3 text-xl">Appearance</h2>
        <div className="flex items-center gap-4 rounded-xl border bg-card p-4">
          <span className="text-sm">Theme</span>
          <ThemeSegmented />
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ Groups */

function locationLabel(g: Pick<SettingsGroup, "todoistProjectId" | "todoistSectionId">, meta?: TodoistMeta) {
  if (!g.todoistProjectId) return "Not mapped";
  const p = meta?.projects.find((x) => x.id === g.todoistProjectId);
  const s = g.todoistSectionId ? meta?.sections.find((x) => x.id === g.todoistSectionId) : null;
  if (!meta) return "Mapped";
  if (!p) return "Project not found";
  return s ? `${p.name} › ${s.name}` : g.todoistSectionId ? `${p.name} › (missing section)` : p.name;
}

function GroupsSection({ groups, meta, metaLoading, metaError }: { groups: SettingsGroup[]; meta?: TodoistMeta; metaLoading: boolean; metaError: boolean }) {
  const [editing, setEditing] = useState<SettingsGroup | "new" | null>(null);
  const { run, pending } = useAction();
  const active = groups.filter((g) => !g.archived);
  const archived = groups.filter((g) => g.archived);

  const move = (idx: number, dir: -1 | 1) => {
    const ids = active.map((g) => g.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    run(async () => {
      try {
        unwrap(await reorderGroupsAction([...ids, ...archived.map((g) => g.id)]));
      } catch {}
    });
  };

  const archive = (g: SettingsGroup, value: boolean) =>
    run(async () => {
      try {
        unwrap(await archiveGroupAction(g.id, value));
        toast.success(value ? `Archived ${g.name}. Its Todoist tasks are untouched.` : `Restored ${g.name}`);
      } catch {}
    });

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-xl">Groups</h2>
        <Button size="sm" className="ml-auto" onClick={() => setEditing("new")}><Plus /> New group</Button>
      </div>
      <p className="-mt-1 mb-3 text-sm text-muted-foreground">
        Each group maps to one Todoist project or section. The dashboard only reads and writes tasks inside these mappings.
        {metaError && <span className="text-destructive"> Couldn&apos;t load Todoist projects right now.</span>}
      </p>
      <ul className={cn("divide-y rounded-xl border bg-card", pending && "opacity-70")}>
        {active.map((g, i) => (
          <li key={g.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${g.color}1f`, color: g.color }}>
              <GroupIcon name={g.icon} className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{g.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {metaLoading ? "Loading Todoist…" : locationLabel(g, meta)} · {KINDS.find((k) => k.value === g.kind)?.label}
                {g.calendarMatch.length > 0 && ` · ${g.calendarMatch.length} calendar rule${g.calendarMatch.length > 1 ? "s" : ""}`}
              </p>
            </div>
            <div className="flex items-center">
              <Button variant="ghost" size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp /></Button>
              <Button variant="ghost" size="icon-sm" onClick={() => move(i, 1)} disabled={i === active.length - 1} aria-label="Move down"><ArrowDown /></Button>
              <Button variant="ghost" size="icon-sm" onClick={() => setEditing(g)} aria-label={`Edit ${g.name}`}><Pencil /></Button>
              <Button variant="ghost" size="icon-sm" onClick={() => archive(g, true)} aria-label={`Archive ${g.name}`}><Archive /></Button>
            </div>
          </li>
        ))}
        {active.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No active groups. Run <code>pnpm seed</code> or create one.</li>}
      </ul>
      {archived.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Archived</p>
          <ul className="divide-y rounded-xl border bg-card/60">
            {archived.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
                <GroupIcon name={g.icon} className="size-4" />
                <span className="flex-1">{g.name}</span>
                <Button variant="ghost" size="sm" onClick={() => archive(g, false)}><ArchiveRestore /> Restore</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && (
        <GroupDialog
          key={editing === "new" ? "new" : editing.id}
          group={editing === "new" ? null : editing}
          meta={meta}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function GroupDialog({ group, meta, onClose }: { group: SettingsGroup | null; meta?: TodoistMeta; onClose: () => void }) {
  const [name, setName] = useState(group?.name ?? "");
  const [slug, setSlug] = useState(group?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(group));
  const [kind, setKind] = useState<GroupKind>(group?.kind ?? "plain");
  const [color, setColor] = useState(group?.color ?? "#C96442");
  const [icon, setIcon] = useState(group?.icon ?? "list-todo");
  const [projectId, setProjectId] = useState(group?.todoistProjectId ?? "");
  const [sectionId, setSectionId] = useState(group?.todoistSectionId ?? "");
  const [rules, setRules] = useState<CalendarMatchRule[]>(group?.calendarMatch ?? []);
  const { run, pending } = useAction();

  const projects = (meta?.projects ?? []).filter((p) => !p.isInbox);
  const sections = (meta?.sections ?? []).filter((s) => s.projectId === projectId);

  const save = () =>
    run(async () => {
      try {
        unwrap(
          await saveGroupAction(group?.id ?? null, {
            name: name.trim(),
            slug: slug.trim(),
            kind,
            color,
            icon,
            todoistProjectId: projectId || null,
            todoistSectionId: projectId && sectionId ? sectionId : null,
            calendarMatch: rules.filter((r) => r.value.trim()).map((r) => ({ ...r, value: r.value.trim() })),
          }),
        );
        toast.success(group ? "Group updated" : "Group created");
        onClose();
      } catch {}
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">{group ? `Edit ${group.name}` : "New group"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field label="URL slug">
              <Input
                required
                value={slug}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
            </Field>
            <Field label="Context panel">
              <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as GroupKind)}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Color">
              <div className="flex items-center gap-2">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border bg-transparent" aria-label="Pick color" />
                <Input value={color} onChange={(e) => setColor(e.target.value)} pattern="#[0-9a-fA-F]{6}" className="font-mono" />
              </div>
            </Field>
          </div>

          <Field label="Icon">
            <div className="flex flex-wrap gap-1">
              {Object.keys(GROUP_ICONS).map((key) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setIcon(key)}
                  aria-label={key}
                  className={cn("flex size-8 items-center justify-center rounded-lg border", icon === key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
                >
                  <GroupIcon name={key} className="size-4" />
                </button>
              ))}
            </div>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Todoist project">
              <NativeSelect
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setSectionId("");
                }}
                disabled={!meta}
              >
                <option value="">{meta ? "— not mapped —" : "Loading…"}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Section (optional)" hint="Leave empty to use the whole project.">
              <NativeSelect value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!projectId}>
                <option value="">— whole project —</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </Field>
          </div>

          <Field label="Calendar rules" hint="Events whose title matches any rule are treated as time for this group (case-insensitive).">
            <div className="space-y-2">
              {rules.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <NativeSelect
                    value={r.type}
                    onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, type: e.target.value as CalendarMatchRule["type"] } : x)))}
                    className="w-32"
                  >
                    {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </NativeSelect>
                  <Input
                    value={r.value}
                    placeholder="Applications Block"
                    onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  />
                  <Button type="button" variant="ghost" size="icon-sm" className="h-8" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove rule">
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setRules((rs) => [...rs, { type: "equals", value: "" }])}>
                <Plus /> Add rule
              </Button>
            </div>
          </Field>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- Targets */

function TargetsSection({ targets }: { targets: TargetSetting[] }) {
  const [values, setValues] = useState(() => targets.map((t) => ({ ...t, minS: t.min?.toString() ?? "", maxS: t.max?.toString() ?? "" })));
  const { run, pending } = useAction();
  const toNum = (s: string) => (s.trim() === "" ? null : Number(s));
  return (
    <section>
      <h2 className="mb-1 text-xl">Default weekly targets</h2>
      <p className="mb-3 text-sm text-muted-foreground">Used every week unless you adjust a specific week on the Scorecard.</p>
      <form
        className="rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            try {
              unwrap(await saveTargetsAction(null, values.map((v) => ({ metric: v.metric, min: toNum(v.minS), max: toNum(v.maxS) }))));
              toast.success("Default targets saved");
            } catch {}
          });
        }}
      >
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {values.map((v, i) => (
            <div key={v.metric} className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2">
              <span className="text-sm">
                {v.label}
                {v.isCap && <span className="text-muted-foreground"> (cap, h)</span>}
              </span>
              <Input
                aria-label={`${v.label} minimum`}
                type="number"
                min="0"
                step="0.5"
                placeholder="min"
                disabled={v.isCap}
                value={v.minS}
                onChange={(e) => setValues((vs) => vs.map((x, j) => (j === i ? { ...x, minS: e.target.value } : x)))}
              />
              <Input
                aria-label={`${v.label} maximum`}
                type="number"
                min="0"
                step="0.5"
                placeholder={v.isCap ? "cap" : "max"}
                value={v.maxS}
                onChange={(e) => setValues((vs) => vs.map((x, j) => (j === i ? { ...x, maxS: e.target.value } : x)))}
              />
            </div>
          ))}
        </div>
        <Button type="submit" size="sm" className="mt-4" disabled={pending}>Save defaults</Button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------- Connections */

function ConnectionsSection({ status }: { status: { todoist: boolean; google: "ok" | "needs-login" | "error" } }) {
  return (
    <section>
      <h2 className="mb-3 text-xl">Connections</h2>
      <ul className="divide-y rounded-xl border bg-card">
        <li className="flex items-center gap-3 px-4 py-3 text-sm">
          {status.todoist ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}
          <span className="flex-1">Todoist</span>
          <span className="text-muted-foreground">{status.todoist ? "Connected" : "Check TODOIST_API_TOKEN"}</span>
        </li>
        <li className="flex items-center gap-3 px-4 py-3 text-sm">
          {status.google === "ok" ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}
          <span className="flex-1">Google Calendar (read-only)</span>
          {status.google === "ok" ? (
            <span className="text-muted-foreground">Connected</span>
          ) : (
            <form action={reconnectGoogleAction}>
              <Button size="sm" variant="outline" type="submit">Re-connect</Button>
            </form>
          )}
        </li>
      </ul>
    </section>
  );
}
