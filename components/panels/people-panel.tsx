"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MessageSquarePlus, Pencil, Plus } from "lucide-react";
import type { PanelData } from "@/lib/services/panels";
import type { Contact, ContactRelationship } from "@/lib/db/schema";
import { logTouchAction, saveContactAction } from "@/app/actions/records";
import { unwrap } from "@/lib/client/fetcher";
import { formatDate, relativeDays, toDateInput } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/states";
import { dateInputToIso, Field, FormDialog, NativeSelect, PanelHeader, str, useAction, WeeklyCounter } from "./shared";
import { cn } from "@/lib/utils";

type Data = Extract<PanelData, { kind: "people" }>;

const RELATIONSHIPS: { value: ContactRelationship; label: string }[] = [
  { value: "friend", label: "Friend" },
  { value: "ex_colleague", label: "Ex-colleague" },
  { value: "recruiter", label: "Recruiter" },
  { value: "cold", label: "Cold" },
];

const TOUCH_TYPES = [
  { value: "outreach", label: "Outreach" },
  { value: "follow_up", label: "Follow-up" },
  { value: "conversation", label: "Conversation" },
] as const;

export function PeoplePanel({ data, readOnly, color }: { data: Data; readOnly: boolean; color: string }) {
  const [now] = useState(() => Date.now());
  return (
    <div>
      <PanelHeader title="Contacts">
        <WeeklyCounter label="outreach" actual={data.weekly.outreach.actual} min={data.weekly.outreach.min} max={data.weekly.outreach.max} color={color} />
        <WeeklyCounter label="follow-ups" actual={data.weekly.followUps.actual} min={data.weekly.followUps.min} max={data.weekly.followUps.max} color={color} />
        <WeeklyCounter label="conversations" actual={data.weekly.conversations.actual} min={data.weekly.conversations.min} max={data.weekly.conversations.max} color={color} />
        {!readOnly && <ContactDialog trigger={<Button size="sm"><Plus /> Add</Button>} />}
      </PanelHeader>

      {data.contacts.length === 0 ? (
        <EmptyState title="No contacts yet">
          Add one, or tell the assistant “I messaged Priya at Stripe today.”
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium max-sm:hidden">Relationship</th>
                <th className="px-3 py-2 font-medium max-md:hidden">Channel</th>
                <th className="px-3 py-2 font-medium">Last contact</th>
                <th className="px-3 py-2 font-medium">Next check-in</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.contacts.map((c) => {
                const overdue = c.nextCheckInAt && new Date(c.nextCheckInAt).getTime() < now;
                return (
                  <tr key={c.id} className={cn(overdue && "bg-destructive/5")}>
                    <td className="px-3 py-2">
                      <p className={cn("font-medium", overdue && "text-destructive")}>{c.name}</p>
                      {c.company && <p className="text-xs text-muted-foreground">{c.company}</p>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground max-sm:hidden">{RELATIONSHIPS.find((r) => r.value === c.relationship)?.label}</td>
                    <td className="px-3 py-2 text-muted-foreground max-md:hidden">{c.channel ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{c.lastContactAt ? relativeDays(c.lastContactAt) : "—"}</td>
                    <td className={cn("px-3 py-2", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {c.nextCheckInAt ? `${formatDate(c.nextCheckInAt)} · ${relativeDays(c.nextCheckInAt)}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {!readOnly && (
                        <div className="flex justify-end gap-1">
                          <LogTouch contact={c} />
                          <ContactDialog
                            contact={c}
                            trigger={
                              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`}>
                                <Pencil />
                              </Button>
                            }
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LogTouch({ contact }: { contact: Contact }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof TOUCH_TYPES)[number]["value"]>("follow_up");
  const [next, setNext] = useState("");
  const [note, setNote] = useState("");
  const { run, pending } = useAction();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7">
          <MessageSquarePlus /> Log touch
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              try {
                unwrap(await logTouchAction({ contactId: contact.id, type, nextCheckInAt: dateInputToIso(next), note: note || undefined }));
                toast.success(`Logged ${TOUCH_TYPES.find((t) => t.value === type)?.label.toLowerCase()} with ${contact.name}`);
                setOpen(false);
                setNote("");
                setNext("");
              } catch {}
            });
          }}
        >
          <p className="font-serif">Log a touch with {contact.name}</p>
          <div className="flex gap-1">
            {TOUCH_TYPES.map((t) => (
              <button
                type="button"
                key={t.value}
                onClick={() => setType(t.value)}
                className={cn("flex-1 rounded-md border px-2 py-1 text-xs", type === t.value ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Field label="Next check-in" hint="Defaults to 1 week (2 weeks after a conversation).">
            <Input type="date" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Note (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </Field>
          <Button type="submit" size="sm" className="w-full" disabled={pending}>Log</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function ContactDialog({ trigger, contact: c }: { trigger: React.ReactNode; contact?: Contact }) {
  return (
    <FormDialog
      trigger={trigger}
      title={c ? c.name : "Add contact"}
      onSubmit={async (f) => {
        try {
          unwrap(
            await saveContactAction({
              id: c?.id,
              name: str(f, "name"),
              company: str(f, "company") ?? null,
              relationship: (str(f, "relationship") as ContactRelationship) ?? "cold",
              channel: str(f, "channel") ?? null,
              nextCheckInAt: dateInputToIso(str(f, "nextCheckInAt")),
              notes: str(f, "notes") ?? null,
            }),
          );
          toast.success(c ? "Contact updated" : "Contact added");
          return true;
        } catch {
          return false;
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input name="name" required defaultValue={c?.name} /></Field>
        <Field label="Company"><Input name="company" defaultValue={c?.company ?? ""} /></Field>
        <Field label="Relationship">
          <NativeSelect name="relationship" defaultValue={c?.relationship ?? "cold"}>
            {RELATIONSHIPS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Channel"><Input name="channel" defaultValue={c?.channel ?? ""} placeholder="LinkedIn, email, text…" /></Field>
      </div>
      <Field label="Next check-in"><Input name="nextCheckInAt" type="date" defaultValue={toDateInput(c?.nextCheckInAt)} /></Field>
      <Field label="Notes"><Textarea name="notes" rows={3} defaultValue={c?.notes ?? ""} /></Field>
    </FormDialog>
  );
}
