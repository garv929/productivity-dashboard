"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Clock, Pencil, Plus } from "lucide-react";
import type { PanelData } from "@/lib/services/panels";
import type { IncomeOption, IncomeStatus, IncomeType } from "@/lib/db/schema";
import { logSideIncomeHoursAction, saveIncomeOptionAction } from "@/app/actions/records";
import { unwrap } from "@/lib/client/fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/states";
import { Field, FormDialog, NativeSelect, num, PanelHeader, str, useAction, WeeklyCounter } from "./shared";

type Data = Extract<PanelData, { kind: "options" }>;

const TYPES: { value: IncomeType; label: string }[] = [
  { value: "online_work", label: "Online work" },
  { value: "part_time", label: "Part-time" },
  { value: "freelance", label: "Freelance" },
  { value: "other", label: "Other" },
];
const STATUSES: { value: IncomeStatus; label: string }[] = [
  { value: "exploring", label: "Exploring" },
  { value: "trying", label: "Trying" },
  { value: "keep", label: "Keep" },
  { value: "drop", label: "Drop" },
];

export function OptionsPanel({ data, readOnly, color }: { data: Data; readOnly: boolean; color: string }) {
  const { run, pending } = useAction();
  const setStatus = (o: IncomeOption, status: IncomeStatus) =>
    run(async () => {
      try {
        unwrap(await saveIncomeOptionAction({ id: o.id, status }));
      } catch {}
    });

  return (
    <div>
      <PanelHeader title="Income options">
        <WeeklyCounter label="hours (cap)" actual={data.hours.logged} min={null} max={data.hours.cap} color={color} cap />
        {!readOnly && <LogHours options={data.options} logged={data.hours.logged} cap={data.hours.cap} />}
        {!readOnly && <OptionDialog trigger={<Button size="sm"><Plus /> Add</Button>} />}
      </PanelHeader>
      {data.options.length === 0 ? (
        <EmptyState title="No income options yet">Add one, or ask the assistant “What’s a good side gig to try this week?”</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Option</th>
                <th className="px-3 py-2 font-medium max-sm:hidden">Type</th>
                <th className="px-3 py-2 font-medium">$/h</th>
                <th className="px-3 py-2 font-medium max-sm:hidden">h/week</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium max-md:hidden">Verdict</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.options.map((o) => (
                <tr key={o.id}>
                  <td className="px-3 py-2 font-medium">{o.name}</td>
                  <td className="px-3 py-2 text-muted-foreground max-sm:hidden">{TYPES.find((t) => t.value === o.type)?.label}</td>
                  <td className="px-3 py-2">{o.expectedHourly != null ? `$${o.expectedHourly}` : "—"}</td>
                  <td className="px-3 py-2 max-sm:hidden">{o.hoursPerWeek ?? "—"}</td>
                  <td className="px-3 py-2">
                    <NativeSelect value={o.status} disabled={readOnly || pending} onChange={(e) => setStatus(o, e.target.value as IncomeStatus)} className="h-7 w-28 text-xs">
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </NativeSelect>
                  </td>
                  <td className="max-w-64 truncate px-3 py-2 text-muted-foreground max-md:hidden">{o.verdictNotes}</td>
                  <td className="px-3 py-2">
                    {!readOnly && <OptionDialog option={o} trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${o.name}`}><Pencil /></Button>} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LogHours({ options, logged, cap }: { options: IncomeOption[]; logged: number; cap: number }) {
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("1");
  const [optionId, setOptionId] = useState("");
  const [confirmOver, setConfirmOver] = useState(false);
  const { run, pending } = useAction();

  const submit = (override: boolean) =>
    run(async () => {
      const h = Number(hours);
      const res = await logSideIncomeHoursAction({ hours: h, optionId: optionId || null, override });
      if (!res.ok && res.code === "cap_exceeded") {
        setConfirmOver(true);
        return;
      }
      try {
        const d = unwrap(res);
        toast.success(`Logged ${h}h · ${d.totalAfter} / ${d.cap}h this week`);
        setOpen(false);
        setConfirmOver(false);
      } catch {}
    });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline"><Clock /> Log hours</Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
            <p className="font-serif">Log side-income hours</p>
            <p className="text-xs text-muted-foreground">{logged} of {cap}h used this week.</p>
            <Field label="Hours"><Input type="number" step="0.25" min="0.25" max="24" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
            <Field label="Option">
              <NativeSelect value={optionId} onChange={(e) => setOptionId(e.target.value)}>
                <option value="">— general —</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </NativeSelect>
            </Field>
            <Button type="submit" size="sm" className="w-full" disabled={pending}>Log</Button>
          </form>
        </PopoverContent>
      </Popover>
      <AlertDialog open={confirmOver} onOpenChange={setConfirmOver}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Over your weekly cap</AlertDialogTitle>
            <AlertDialogDescription>
              Logging {hours}h would put you at {Math.round((logged + Number(hours)) * 10) / 10}h, over the {cap}h cap you set to protect job-search time. Log it anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => submit(true)}>Log anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function OptionDialog({ trigger, option: o }: { trigger: React.ReactNode; option?: IncomeOption }) {
  return (
    <FormDialog
      trigger={trigger}
      title={o ? o.name : "Add income option"}
      onSubmit={async (f) => {
        try {
          unwrap(
            await saveIncomeOptionAction({
              id: o?.id,
              name: str(f, "name"),
              type: (str(f, "type") as IncomeType) ?? "other",
              expectedHourly: num(f, "expectedHourly"),
              hoursPerWeek: num(f, "hoursPerWeek"),
              status: (str(f, "status") as IncomeStatus) ?? "exploring",
              verdictNotes: str(f, "verdictNotes") ?? null,
            }),
          );
          toast.success("Saved");
          return true;
        } catch {
          return false;
        }
      }}
    >
      <Field label="Name"><Input name="name" required defaultValue={o?.name} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <NativeSelect name="type" defaultValue={o?.type ?? "other"}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Status">
          <NativeSelect name="status" defaultValue={o?.status ?? "exploring"}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Expected $/hour"><Input name="expectedHourly" type="number" step="0.5" min="0" defaultValue={o?.expectedHourly ?? ""} /></Field>
        <Field label="Hours / week"><Input name="hoursPerWeek" type="number" step="0.5" min="0" defaultValue={o?.hoursPerWeek ?? ""} /></Field>
      </div>
      <Field label="Verdict notes"><Textarea name="verdictNotes" rows={3} defaultValue={o?.verdictNotes ?? ""} /></Field>
    </FormDialog>
  );
}
