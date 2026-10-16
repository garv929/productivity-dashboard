"use client";

import { toast } from "sonner";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import type { NetworkingCall } from "@/lib/db/schema";
import { deleteNetworkingCallAction, saveNetworkingCallAction } from "@/app/actions/records";
import { unwrap } from "@/lib/client/fetcher";
import { formatDate, relativeDays, toDatetimeLocal } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/states";
import { Field, FormDialog, PanelHeader, str, useAction } from "./shared";

type Contact = { id: string; name: string; company: string | null };

const WHEN: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

/**
 * Scheduled calls and coffee chats, soonest first. Shown at the top of the Networking page
 * and under upcoming interviews on Interview Prep (same calls on both).
 */
export function UpcomingCalls({ data, readOnly }: { data: { calls: NetworkingCall[]; contacts: Contact[] }; readOnly: boolean }) {
  return (
    <div>
      <PanelHeader title="Upcoming networking calls">
        {!readOnly && <CallDialog contacts={data.contacts} trigger={<Button size="sm"><CalendarPlus /> Add</Button>} />}
      </PanelHeader>
      {data.calls.length === 0 ? (
        <EmptyState title="No networking calls scheduled">
          Add one, or tell the assistant “I have a coffee chat with Priya from Ramp Tuesday at 4pm.”
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">With</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Date ↑</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">Notes</th>
                {!readOnly && <th className="w-20 px-2 py-2"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.calls.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-3 py-2 font-medium">{c.personName}</td>
                  <td className="px-3 py-2">{c.company ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDate(c.scheduledAt, WHEN)}
                    <span className="text-muted-foreground"> · {relativeDays(c.scheduledAt)}</span>
                  </td>
                  <td className="hidden max-w-72 px-3 py-2 text-muted-foreground lg:table-cell">
                    <p className="line-clamp-2 whitespace-pre-line" title={c.notes ?? undefined}>{c.notes || "—"}</p>
                  </td>
                  {!readOnly && (
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <CallDialog
                        call={c}
                        contacts={data.contacts}
                        trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit call with ${c.personName}`}><Pencil /></Button>}
                      />
                      <DeleteCallButton call={c} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DeleteCallButton({ call: c }: { call: NetworkingCall }) {
  const { run, pending } = useAction();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`Delete call with ${c.personName}`} className="text-muted-foreground hover:text-destructive">
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif">Delete this networking call?</AlertDialogTitle>
          <AlertDialogDescription>
            The call with {c.personName}{c.company ? ` (${c.company})` : ""} on {formatDate(c.scheduledAt, WHEN)} will be removed, along with its notes. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              run(async () => {
                try {
                  unwrap(await deleteNetworkingCallAction(c.id));
                  toast.success("Networking call deleted");
                } catch {}
              })
            }
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CallDialog({ trigger, call: c, contacts }: { trigger: React.ReactNode; call?: NetworkingCall; contacts: Contact[] }) {
  return (
    <FormDialog
      trigger={trigger}
      title={c ? "Edit networking call" : "Add networking call"}
      onSubmit={async (f) => {
        const date = str(f, "date");
        const time = str(f, "time");
        if (!date || !time) {
          toast.error("Add both a date and a time.");
          return false;
        }
        try {
          unwrap(
            await saveNetworkingCallAction({
              id: c?.id,
              personName: str(f, "personName"),
              company: str(f, "company") ?? null,
              // Read as local time in the browser.
              scheduledAt: new Date(`${date}T${time}`).toISOString(),
              notes: str(f, "notes") ?? null,
            }),
          );
          toast.success(c ? "Call updated" : "Call added");
          return true;
        } catch {
          return false;
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="With *" hint="Pick a contact or type any name.">
          <Input name="personName" required defaultValue={c?.personName} list="call-contacts" placeholder="Priya Shah" />
          <datalist id="call-contacts">
            {contacts.map((p) => <option key={p.id} value={p.name}>{p.company ?? ""}</option>)}
          </datalist>
        </Field>
        <Field label="Company" hint="Filled from the contact if left blank.">
          <Input name="company" defaultValue={c?.company ?? ""} placeholder="Ramp" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date *"><Input name="date" type="date" required defaultValue={toDatetimeLocal(c?.scheduledAt).slice(0, 10)} /></Field>
        <Field label="Time *"><Input name="time" type="time" required defaultValue={toDatetimeLocal(c?.scheduledAt).slice(11, 16)} /></Field>
      </div>
      <Field label="Notes"><Textarea name="notes" rows={3} defaultValue={c?.notes ?? ""} placeholder="What to ask, how you met…" /></Field>
    </FormDialog>
  );
}
