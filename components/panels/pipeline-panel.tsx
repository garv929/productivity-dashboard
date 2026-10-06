"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, LayoutGrid, Pencil, Plus, Rows3 } from "lucide-react";
import type { PanelData } from "@/lib/services/panels";
import type { Application, ApplicationStage } from "@/lib/db/schema";
import { saveApplicationAction } from "@/app/actions/records";
import { unwrap } from "@/lib/client/fetcher";
import { formatDate, relativeDays, toDateInput } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/states";
import { CompanyTierBadge } from "@/components/company-tier-badge";
import { tierForApplication, type Tier } from "@/lib/domain/company-tier";
import { dateInputToIso, Field, FormDialog, NativeSelect, PanelHeader, str, TierSelect, useAction, WeeklyCounter } from "./shared";
import { cn } from "@/lib/utils";

type Data = Extract<PanelData, { kind: "pipeline" }>;

const STAGES: { value: ApplicationStage; label: string }[] = [
  { value: "researching", label: "Researching" },
  { value: "tailoring", label: "Tailoring" },
  { value: "applied", label: "Applied" },
  { value: "screen", label: "Screen" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "closed", label: "Closed" },
];

export function PipelinePanel({ data, readOnly, color }: { data: Data; readOnly: boolean; color: string }) {
  const [view, setView] = useState<"board" | "table">("board");
  const { run, pending } = useAction();

  const changeStage = (a: Application, stage: ApplicationStage) =>
    run(async () => {
      try {
        const res = unwrap(await saveApplicationAction({ id: a.id, stage }));
        toast.success(res.loggedApplication ? `${a.companyName} → Applied · logged 1 application` : `${a.companyName} → ${STAGES.find((s) => s.value === stage)?.label}`);
      } catch {}
    });

  return (
    <div>
      <PanelHeader title="Application pipeline">
        <WeeklyCounter label="applications" actual={data.weekly.actual} min={data.weekly.target} color={color} />
        <div className="flex rounded-lg border p-0.5">
          <Button variant={view === "board" ? "secondary" : "ghost"} size="icon-sm" onClick={() => setView("board")} aria-label="Board view">
            <LayoutGrid />
          </Button>
          <Button variant={view === "table" ? "secondary" : "ghost"} size="icon-sm" onClick={() => setView("table")} aria-label="Table view">
            <Rows3 />
          </Button>
        </div>
        {!readOnly && <ApplicationDialog trigger={<Button size="sm"><Plus /> Add</Button>} companies={data.companies} />}
      </PanelHeader>

      {data.applications.length === 0 ? (
        <EmptyState title="No applications yet">
          Add one, or tell the assistant “I just applied to Ramp&apos;s deployment strategist role.”
        </EmptyState>
      ) : view === "board" ? (
        <div className={cn("-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0", pending && "opacity-70")}>
          {STAGES.map((s) => {
            const items = data.applications.filter((a) => a.stage === s.value);
            return (
              <div key={s.value} className="w-64 shrink-0 rounded-xl bg-surface p-2">
                <div className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
                  <span>{s.label}</span>
                  <span>{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((a) => (
                    <ApplicationCard key={a.id} a={a} readOnly={readOnly} onStage={changeStage} companies={data.companies} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Stage</th>
                <th className="px-3 py-2 font-medium">Applied</th>
                <th className="px-3 py-2 font-medium">Follow-up</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.applications.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2 font-medium">
                    <span className="flex items-center gap-2">
                      {a.url ? <a className="hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.companyName}</a> : a.companyName}
                      <CompanyTierBadge tier={tierForApplication(a, data.companies)} />
                    </span>
                  </td>
                  <td className="px-3 py-2">{a.role}</td>
                  <td className="px-3 py-2">
                    <NativeSelect value={a.stage} disabled={readOnly} onChange={(e) => changeStage(a, e.target.value as ApplicationStage)} className="h-7 w-32">
                      {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(a.appliedAt)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(a.nextFollowUpAt)}</td>
                  <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">{a.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ApplicationCard({
  a,
  readOnly,
  onStage,
  companies,
}: {
  a: Application;
  readOnly: boolean;
  onStage: (a: Application, s: ApplicationStage) => void;
  companies: Data["companies"];
}) {
  const [now] = useState(() => Date.now());
  const followUpDue = a.nextFollowUpAt && new Date(a.nextFollowUpAt).getTime() < now;
  return (
    <div className="rounded-lg border bg-card p-2.5 text-sm">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-medium">{a.companyName}</p>
            <CompanyTierBadge tier={tierForApplication(a, companies)} />
          </div>
          <p className="truncate text-xs text-muted-foreground">{a.role}</p>
        </div>
        {a.url && (
          <a href={a.url} target="_blank" rel="noreferrer" className="p-1 text-muted-foreground hover:text-foreground" aria-label="Open posting">
            <ExternalLink className="size-3.5" />
          </a>
        )}
        {!readOnly && (
          <ApplicationDialog
            application={a}
            companies={companies}
            trigger={
              <button className="p-1 text-muted-foreground hover:text-foreground" aria-label="Edit application">
                <Pencil className="size-3.5" />
              </button>
            }
          />
        )}
      </div>
      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
        {a.appliedAt && <p>Applied {formatDate(a.appliedAt)} · {relativeDays(a.appliedAt)}</p>}
        {a.nextFollowUpAt && <p className={cn(followUpDue && "text-destructive")}>Follow up {formatDate(a.nextFollowUpAt)}</p>}
        {a.notes && <p className="line-clamp-2">{a.notes}</p>}
      </div>
      {!readOnly && (
        <NativeSelect value={a.stage} onChange={(e) => onStage(a, e.target.value as ApplicationStage)} className="mt-2 h-7 text-xs" aria-label="Stage">
          {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </NativeSelect>
      )}
    </div>
  );
}

function ApplicationDialog({ trigger, application: a, companies }: { trigger: React.ReactNode; application?: Application; companies: Data["companies"] }) {
  const knownTier = a ? tierForApplication(a, companies) : null;
  return (
    <FormDialog
      trigger={trigger}
      title={a ? `${a.companyName} – ${a.role}` : "Add application"}
      onSubmit={async (f) => {
        try {
          unwrap(
            await saveApplicationAction({
              id: a?.id,
              companyName: str(f, "companyName"),
              role: str(f, "role"),
              url: str(f, "url") ?? null,
              stage: (str(f, "stage") as ApplicationStage) ?? "researching",
              nextFollowUpAt: dateInputToIso(str(f, "nextFollowUpAt")),
              notes: str(f, "notes") ?? null,
              tier: str(f, "tier") as Tier | undefined,
            }),
          );
          toast.success(a ? "Application updated" : "Application added");
          return true;
        } catch {
          return false;
        }
      }}
    >
      <CompanyAndTier application={a} companies={companies} initialTier={knownTier} />
      <Field label="Role">
        <Input name="role" required defaultValue={a?.role} />
      </Field>
      <Field label="Link">
        <Input name="url" type="url" defaultValue={a?.url ?? ""} placeholder="https://…" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Stage">
          <NativeSelect name="stage" defaultValue={a?.stage ?? "researching"}>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Next follow-up">
          <Input name="nextFollowUpAt" type="date" defaultValue={toDateInput(a?.nextFollowUpAt)} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea name="notes" rows={3} defaultValue={a?.notes ?? ""} />
      </Field>
    </FormDialog>
  );
}

/** Company name plus its required tier; picking a company that already has a tier fills it in. */
function CompanyAndTier({ application: a, companies, initialTier }: { application?: Application; companies: Data["companies"]; initialTier: Tier | null }) {
  const [tier, setTier] = useState<Tier | null>(initialTier);
  const [touched, setTouched] = useState(false);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Company">
        <Input
          name="companyName"
          required
          defaultValue={a?.companyName}
          list="company-names"
          onChange={(e) => {
            if (touched) return;
            const match = tierForApplication({ companyId: null, companyName: e.target.value }, companies);
            setTier(match);
          }}
        />
        <datalist id="company-names">{companies.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      </Field>
      <Field label="Tier" hint="Shared by all applications to this company.">
        <TierSelect
          name="tier"
          required
          placeholder="Pick a tier"
          value={tier}
          onChange={(t) => {
            setTouched(true);
            setTier(t);
          }}
        />
      </Field>
    </div>
  );
}
