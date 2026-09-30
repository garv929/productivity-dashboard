"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Link2, Loader2, Pencil, Plus, Sparkles } from "lucide-react";
import type { PanelData } from "@/lib/services/panels";
import type { Company, CompanyStatus } from "@/lib/db/schema";
import { saveCompanyAction } from "@/app/actions/records";
import { fetcher, unwrap } from "@/lib/client/fetcher";
import { logoUrl, normalizeDomain, type CompanySuggestion } from "@/lib/domain/company-lookup";
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
                <CompanyLogo name={c.name} domain={c.domain} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{c.name}</p>
                  {c.domain && (
                    <a
                      href={`https://${c.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {c.domain} <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px]", STATUS_STYLE[c.status])}>
                  {STATUSES.find((s) => s.value === c.status)?.label}
                </span>
              </div>
              {c.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>}
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
              domain: str(f, "domain") ?? null,
              description: str(f, "description") ?? null,
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
      <EnrichedFields company={c} />
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

function CompanyLogo({ name, domain }: { name: string; domain: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!domain || failed) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-medium text-muted-foreground">
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    // Tiny remote favicon; next/image would need a remotePatterns entry for no benefit.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl(domain)} alt="" className="size-8 shrink-0 rounded-lg border bg-white p-1" onError={() => setFailed(true)} />
  );
}

/** Name with company autocomplete; picking one fills the website and a description from its homepage. */
function EnrichedFields({ company: c }: { company?: Company }) {
  const [name, setName] = useState(c?.name ?? "");
  const [domain, setDomain] = useState(c?.domain ?? "");
  const [description, setDescription] = useState(c?.description ?? "");
  const [suggestions, setSuggestions] = useState<CompanySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [describing, setDescribing] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestQuery = useRef("");

  useEffect(() => () => clearTimeout(debounce.current), []);

  const search = (value: string) => {
    clearTimeout(debounce.current);
    const q = value.trim();
    latestQuery.current = q;
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetcher<{ suggestions: CompanySuggestion[] }>(`/api/companies/suggest?q=${encodeURIComponent(q)}`);
        if (latestQuery.current !== q) return; // a newer keystroke won
        setSuggestions(res.suggestions);
        setActive(-1);
        setOpen(res.suggestions.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 250);
  };

  const describe = async (d: string, { quiet = false } = {}) => {
    const normalized = normalizeDomain(d);
    if (!normalized) {
      if (!quiet) toast.error("Enter a website like ramp.com first.");
      return;
    }
    setDescribing(true);
    try {
      const res = await fetcher<{ domain: string; description: string | null }>(`/api/companies/describe?domain=${encodeURIComponent(normalized)}`);
      setDomain(res.domain);
      if (res.description) setDescription(res.description);
      else if (!quiet) toast.info(`Couldn't find a description on ${res.domain}.`);
    } catch {
      if (!quiet) toast.error("Couldn't reach that website.");
    } finally {
      setDescribing(false);
    }
  };

  const pick = (s: CompanySuggestion) => {
    clearTimeout(debounce.current);
    latestQuery.current = "";
    setName(s.name);
    setOpen(false);
    setSuggestions([]);
    setDomain(s.domain);
    void describe(s.domain, { quiet: true });
  };

  return (
    <>
      <Field label="Name" hint="Start typing to search; picking a match fills in the website and description.">
        <div className="relative">
          <Input
            name="name"
            required
            autoComplete="off"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              search(e.target.value);
            }}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (!open || suggestions.length === 0) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive((i) => (i + step + suggestions.length) % suggestions.length);
              } else if (e.key === "Enter" && active >= 0) {
                e.preventDefault();
                pick(suggestions[active]);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(false);
              }
            }}
            role="combobox"
            aria-expanded={open}
            aria-controls="company-suggestions"
            aria-autocomplete="list"
          />
          {open && (
            <ul id="company-suggestions" role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-popover p-1 shadow-md">
              {suggestions.map((s, i) => (
                <li
                  key={s.domain}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(s);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm", i === active && "bg-accent")}
                >
                  <CompanyLogo name={s.name} domain={s.domain} />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.domain}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Field>
      <Field label="Website">
        <div className="flex gap-2">
          <Input name="domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="ramp.com" />
          <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" disabled={describing || !domain.trim()} onClick={() => describe(domain)}>
            {describing ? <Loader2 className="animate-spin" /> : <Sparkles />} Look up
          </Button>
        </div>
      </Field>
      <Field label="About">
        <Textarea
          name="description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={describing ? "Reading their homepage…" : "What the company does"}
        />
      </Field>
    </>
  );
}
