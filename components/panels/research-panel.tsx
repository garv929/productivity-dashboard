"use client";

import { toast } from "sonner";
import { Link2, Pencil, Plus } from "lucide-react";
import type { PanelData } from "@/lib/services/panels";
import type { Company, CompanyStatus } from "@/lib/db/schema";
import { saveCompanyAction } from "@/app/actions/records";
import { unwrap } from "@/lib/client/fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/states";
import { Field, FormDialog, NativeSelect, PanelHeader, str, useAction } from "./shared";
import { cn } from "@/lib/utils";

type Data = Extract<PanelData, { kind: "research" }>;

const STATUSES: { value: CompanyStatus; label: string }[] = [
  { value: "researching", label: "Researching" },
  { value: "ready_to_apply", label: "Ready to apply" },
  { value: "ready_to_reach_out", label: "Ready to reach out" },
  { value: "done", label: "Done" },
];

const STATUS_STYLE: Record<CompanyStatus, string> = {
  researching: "bg-muted text-muted-foreground",
  ready_to_apply: "bg-primary/10 text-primary",
  ready_to_reach_out: "bg-chart-3/15 text-chart-3",
  done: "bg-success/10 text-success",
};

export function ResearchPanel({ data, readOnly }: { data: Data; readOnly: boolean }) {
  const { run, pending } = useAction();

  const setStatus = (c: Company, status: CompanyStatus) =>
    run(async () => {
      try {
        const res = unwrap(await saveCompanyAction({ id: c.id, status }));
        toast.success(
          res.createdTask ? `Created “${res.createdTask.content}” in ${res.createdTask.groupName}` : `${c.name} → ${STATUSES.find((s) => s.value === status)?.label}`,
        );
      } catch {}
    });

  return (
    <div>
      <PanelHeader title="Target companies">
        {!readOnly && <CompanyDialog trigger={<Button size="sm"><Plus /> Add</Button>} />}
      </PanelHeader>
      <p className="-mt-1 mb-3 text-sm text-muted-foreground">
        Moving a company to a “Ready” status creates a linked to-do in Applications or Networking &amp; Follow-ups.
      </p>
      {data.companies.length === 0 ? (
        <EmptyState title="No target companies yet">Add one, or tell the assistant “Add Ramp as a target, I like their ops-heavy roles.”</EmptyState>
      ) : (
        <ul className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", pending && "opacity-70")}>
          {data.companies.map((c) => (
            <li key={c.id} className="flex flex-col rounded-xl border bg-card p-3">
              <div className="flex items-start gap-2">
                <p className="flex-1 font-medium">{c.name}</p>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px]", STATUS_STYLE[c.status])}>
                  {STATUSES.find((s) => s.value === c.status)?.label}
                </span>
              </div>
              {c.rolesOfInterest && <p className="mt-1 text-xs text-muted-foreground">Roles: {c.rolesOfInterest}</p>}
              {c.why && <p className="mt-2 line-clamp-3 font-serif text-sm">{c.why}</p>}
              {c.notes && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.notes}</p>}
              {c.todoistTaskId && (
                <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <Link2 className="size-3" /> Linked to-do in Todoist
                </p>
              )}
              {!readOnly && (
                <div className="mt-3 flex items-center gap-2">
                  <NativeSelect value={c.status} onChange={(e) => setStatus(c, e.target.value as CompanyStatus)} className="h-7 text-xs" aria-label="Status">
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </NativeSelect>
                  <CompanyDialog company={c} trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`}><Pencil /></Button>} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompanyDialog({ trigger, company: c }: { trigger: React.ReactNode; company?: Company }) {
  return (
    <FormDialog
      trigger={trigger}
      title={c ? c.name : "Add target company"}
      onSubmit={async (f) => {
        try {
          const res = unwrap(
            await saveCompanyAction({
              id: c?.id,
              name: str(f, "name"),
              why: str(f, "why") ?? null,
              rolesOfInterest: str(f, "rolesOfInterest") ?? null,
              status: (str(f, "status") as CompanyStatus) ?? "researching",
              notes: str(f, "notes") ?? null,
            }),
          );
          toast.success(res.createdTask ? `Saved · created “${res.createdTask.content}”` : "Saved");
          return true;
        } catch {
          return false;
        }
      }}
    >
      <Field label="Name"><Input name="name" required defaultValue={c?.name} /></Field>
      <Field label="Why I'm interested"><Textarea name="why" rows={3} defaultValue={c?.why ?? ""} /></Field>
      <Field label="Roles of interest" hint="Comma-separated; the first is used in the auto-created to-do.">
        <Input name="rolesOfInterest" defaultValue={c?.rolesOfInterest ?? ""} placeholder="Deployment Strategist, Solutions Engineer" />
      </Field>
      <Field label="Status">
        <NativeSelect name="status" defaultValue={c?.status ?? "researching"}>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} /></Field>
    </FormDialog>
  );
}
