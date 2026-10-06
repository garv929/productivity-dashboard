"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, ExternalLink, FileUp, Link2, Loader2, Pencil, Plus, Sparkles, Wand2 } from "lucide-react";
import type { PanelData } from "@/lib/services/panels";
import type { Company, CompanyStatus } from "@/lib/db/schema";
import { enrichMissingCompaniesAction, saveCompanyAction } from "@/app/actions/records";
import { useAssistant } from "@/components/chat/assistant-context";
import { fetcher, unwrap } from "@/lib/client/fetcher";
import { logoUrl, normalizeDomain, type CompanySuggestion } from "@/lib/domain/company-lookup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/states";
import { CompanyTierBadge } from "@/components/company-tier-badge";
import { COMPANY_TIERS, TIER_LABEL, tierLabel, UNRATED_LABEL, type Tier } from "@/lib/domain/company-tier";
import { Field, FormDialog, NativeSelect, PanelHeader, str, TierSelect, useAction } from "./shared";
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

type TierKey = Tier | "unrated";
const TIER_SECTIONS: { key: TierKey; label: string }[] = [
  ...COMPANY_TIERS.map((t) => ({ key: t, label: TIER_LABEL[t] })),
  { key: "unrated", label: UNRATED_LABEL },
];

export function ResearchPanel({ data, readOnly }: { data: Data; readOnly: boolean }) {
  const { run, pending } = useAction();
  const [filter, setFilter] = useState<TierKey | "all">("all");

  const save = (c: Company, patch: { status?: CompanyStatus; tier?: Tier | null }, message: string) =>
    run(async () => {
      try {
        const res = unwrap(await saveCompanyAction({ id: c.id, ...patch }));
        toast.success(res.createdTask ? `Created “${res.createdTask.content}” in ${res.createdTask.groupName}` : message);
      } catch {}
    });
  const setStatus = (c: Company, status: CompanyStatus) => save(c, { status }, `${c.name} → ${STATUSES.find((s) => s.value === status)?.label}`);
  const setTier = (c: Company, tier: Tier | null) => save(c, { tier }, `${c.name} → ${tierLabel(tier)}`);
  const { setOpen: openAssistant } = useAssistant();
  const missingDetails = data.companies.filter((c) => !c.domain || !c.description).length;
  const fillMissing = () =>
    run(async () => {
      try {
        const res = unwrap(await enrichMissingCompaniesAction());
        toast.success(res.filled ? `Filled in details for ${res.filled} of ${res.checked} companies` : `Checked ${res.checked}; nothing new found`);
      } catch {}
    });

  // Companies arrive sorted by tier, then ready-first status, then name.
  const byTier = (key: TierKey) => data.companies.filter((c) => (c.tier ?? "unrated") === key);
  const sections = TIER_SECTIONS.filter((s) => filter === "all" || s.key === filter)
    .map((s) => ({ ...s, companies: byTier(s.key) }))
    .filter((s) => s.companies.length > 0 || filter !== "all");

  return (
    <div>
      <PanelHeader title="Target companies">
        {!readOnly && missingDetails > 0 && (
          <Button size="sm" variant="ghost" onClick={fillMissing} disabled={pending} title="Look up websites and descriptions for companies that are missing them">
            <Wand2 /> Fill missing details ({missingDetails})
          </Button>
        )}
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => openAssistant(true)} title="Attach a spreadsheet or document in the assistant">
            <FileUp /> Import from a file
          </Button>
        )}
        {!readOnly && <CompanyDialog trigger={<Button size="sm"><Plus /> Add</Button>} />}
      </PanelHeader>
      <p className="-mt-1 mb-3 text-sm text-muted-foreground">
        Tier 1 is where you most want to work. Moving a company to a “Ready” status creates a linked to-do in Applications or Networking &amp; Follow-ups.
        {!readOnly && (
          <>
            {" "}
            To import a list, attach any Excel, CSV or Word file in the assistant (📎); no special format needed, or start from the{" "}
            <a href="/company-import-template.csv" download className="inline-flex items-center gap-0.5 text-primary hover:underline">
              template <Download className="size-3" />
            </a>
            .
          </>
        )}
      </p>
      {data.companies.length === 0 ? (
        <EmptyState title="No target companies yet">Add one, or tell the assistant “Add Ramp as a tier 1 target, I like their ops-heavy roles.”</EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by tier">
            {[{ key: "all" as const, label: "All", count: data.companies.length }, ...TIER_SECTIONS.map((s) => ({ ...s, count: byTier(s.key).length }))].map((f) => (
              <Button
                key={f.key}
                variant={filter === f.key ? "secondary" : "ghost"}
                size="sm"
                className="h-7 rounded-full px-3 text-xs"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span className="text-muted-foreground">{f.count}</span>
              </Button>
            ))}
          </div>
          <div className={cn("space-y-6", pending && "opacity-70")}>
            {sections.map((section) => (
              <section key={section.key} aria-label={section.label}>
                <div className="mb-2 flex items-center gap-2">
                  <CompanyTierBadge tier={section.key === "unrated" ? null : section.key} showUnrated />
                  <span className="text-xs text-muted-foreground">
                    {section.companies.length} {section.companies.length === 1 ? "company" : "companies"}
                    {section.key === "unrated" && section.companies.length > 0 && " · pick a tier"}
                  </span>
                </div>
                {section.companies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No companies in {section.label} yet.</p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {section.companies.map((c) => (
                      <CompanyCard key={c.id} c={c} readOnly={readOnly} onStatus={setStatus} onTier={setTier} />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CompanyCard({
  c,
  readOnly,
  onStatus,
  onTier,
}: {
  c: Company;
  readOnly: boolean;
  onStatus: (c: Company, s: CompanyStatus) => void;
  onTier: (c: Company, t: Tier | null) => void;
}) {
  return (
    <li className="flex flex-col rounded-xl border bg-card p-3">
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
        <div className="flex flex-col items-end gap-1">
          <CompanyTierBadge tier={c.tier} />
          <span className={cn("rounded-full px-2 py-0.5 text-[11px]", STATUS_STYLE[c.status])}>
            {STATUSES.find((s) => s.value === c.status)?.label}
          </span>
        </div>
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
        <div className="mt-auto flex items-center gap-2 pt-3">
          <TierSelect value={c.tier} onChange={(t) => onTier(c, t)} className="h-7 w-24 shrink-0 text-xs" aria-label={`Tier for ${c.name}`} />
          <NativeSelect value={c.status} onChange={(e) => onStatus(c, e.target.value as CompanyStatus)} className="h-7 text-xs" aria-label={`Status for ${c.name}`}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </NativeSelect>
          <CompanyDialog company={c} trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`}><Pencil /></Button>} />
        </div>
      )}
    </li>
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
              tier: (str(f, "tier") as Tier | undefined) ?? null,
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
      <Field label="Tier" hint="How much you want to work here, not your odds. Weigh role fit, growth, mission, pay and stability, and people.">
        <TierSelect name="tier" value={c?.tier} />
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
