"use client";

import { toast } from "sonner";
import { ExternalLink, Pencil, Plus } from "lucide-react";
import type { PanelData } from "@/lib/services/panels";
import type { FocusItem, FocusStatus } from "@/lib/db/schema";
import { saveFocusItemAction, setFocusStatusAction } from "@/app/actions/records";
import { unwrap } from "@/lib/client/fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/states";
import { Field, FormDialog, PanelHeader, str, useAction } from "./shared";
import { cn } from "@/lib/utils";

type Data = Extract<PanelData, { kind: "focus" }>;

const LIMIT = 2;
const STATUSES: { value: FocusStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "done", label: "Done" },
  { value: "dropped", label: "Dropped" },
];

export function FocusPanel({ data, readOnly }: { data: Data; readOnly: boolean }) {
  const { run, pending } = useAction();
  const active = data.items.filter((i) => i.status === "active").length;

  const setStatus = (item: FocusItem, status: FocusStatus) => {
    if (status === "active" && item.status !== "active" && active >= LIMIT) {
      toast.error("Finish or drop one first", { description: `Only ${LIMIT} Personal Development items can be active at once.` });
      return;
    }
    run(async () => {
      const res = await setFocusStatusAction(item.id, status);
      if (!res.ok && res.code === "focus_limit") {
        toast.error("Finish or drop one first", { description: res.error });
        return;
      }
      try {
        unwrap(res);
      } catch {}
    });
  };

  return (
    <div>
      <PanelHeader title="Focus items">
        <span className={cn("rounded-full px-2.5 py-1 text-xs", active >= LIMIT ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          {active} / {LIMIT} active
        </span>
        {!readOnly && <FocusDialog trigger={<Button size="sm"><Plus /> Add</Button>} />}
      </PanelHeader>
      <p className="-mt-1 mb-3 text-sm text-muted-foreground">Hard limit of two active items, so each one gets real attention.</p>
      {data.items.length === 0 ? (
        <EmptyState title="No learning or project items yet">Add something that strengthens your candidacy, like a SQL refresher or a small portfolio project.</EmptyState>
      ) : (
        <ul className={cn("grid gap-3 sm:grid-cols-2", pending && "opacity-70")}>
          {data.items.map((i) => (
            <li key={i.id} className={cn("rounded-xl border bg-card p-4", i.status === "active" && "ring-1 ring-primary/40", (i.status === "done" || i.status === "dropped") && "opacity-60")}>
              <div className="flex items-start gap-2">
                <p className="flex-1 font-medium">{i.title}</p>
                {i.link && (
                  <a href={i.link} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open link">
                    <ExternalLink className="size-4" />
                  </a>
                )}
                {!readOnly && <FocusDialog item={i} trigger={<Button variant="ghost" size="icon-sm" aria-label="Edit"><Pencil /></Button>} />}
              </div>
              {i.goal && <p className="mt-1 font-serif text-sm text-muted-foreground">Why it helps: {i.goal}</p>}
              <div className="mt-3 flex flex-wrap gap-1">
                {STATUSES.map((s) => (
                  <button
                    key={s.value}
                    disabled={readOnly}
                    onClick={() => i.status !== s.value && setStatus(i, s.value)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                      i.status === s.value ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FocusDialog({ trigger, item }: { trigger: React.ReactNode; item?: FocusItem }) {
  return (
    <FormDialog
      trigger={trigger}
      title={item ? item.title : "Add focus item"}
      description={item ? undefined : "New items start paused; activate them when there's room."}
      onSubmit={async (f) => {
        try {
          unwrap(await saveFocusItemAction({ id: item?.id, title: str(f, "title"), goal: str(f, "goal") ?? null, link: str(f, "link") ?? null }));
          toast.success("Saved");
          return true;
        } catch {
          return false;
        }
      }}
    >
      <Field label="Title"><Input name="title" required defaultValue={item?.title} /></Field>
      <Field label="Why this helps my candidacy"><Textarea name="goal" rows={3} defaultValue={item?.goal ?? ""} /></Field>
      <Field label="Link"><Input name="link" type="url" defaultValue={item?.link ?? ""} /></Field>
    </FormDialog>
  );
}
