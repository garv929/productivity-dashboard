"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { COMPANY_TIERS, TIER_LABEL, UNRATED_LABEL, type Tier } from "@/lib/domain/company-tier";

export function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h2 className="text-xl">{title}</h2>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** "3 / 8 applications" with a thin progress bar. */
export function WeeklyCounter({
  label,
  actual,
  min,
  max,
  color,
  cap = false,
}: {
  label: string;
  actual: number;
  min: number | null;
  max?: number | null;
  color?: string;
  cap?: boolean;
}) {
  const target = cap ? max : max && min !== null && max !== min ? `${min}–${max}` : min;
  const denom = (cap ? max : (min ?? max)) || 1;
  const pct = Math.min(100, Math.round((actual / Number(denom)) * 100));
  const over = cap && max !== null && max !== undefined && actual > max;
  const met = !cap && min !== null && actual >= min;
  return (
    <div className="min-w-36 rounded-xl border bg-card px-3 py-2">
      <div className="flex items-baseline gap-1">
        <span className={cn("font-serif text-xl", over && "text-destructive", met && "text-success")}>{actual}</span>
        <span className="text-sm text-muted-foreground">/ {target ?? "—"}</span>
        <span className="ml-1 text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", over ? "bg-destructive" : "bg-primary")}
          style={{ width: `${pct}%`, backgroundColor: !over && color ? color : undefined }}
        />
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Company tier picker. "" stands for no tier: shown as "Unrated", or as `placeholder`
 * (e.g. "Pick a tier") which, with `required`, makes the form insist on a tier.
 */
export function TierSelect({
  value,
  onChange,
  placeholder,
  ...props
}: Omit<React.ComponentProps<"select">, "value" | "onChange"> & {
  value?: Tier | null;
  onChange?: (t: Tier | null) => void;
  placeholder?: string;
}) {
  return (
    <NativeSelect
      {...(onChange ? { value: value ?? "", onChange: (e) => onChange((e.target.value || null) as Tier | null) } : { defaultValue: value ?? "" })}
      {...props}
    >
      <option value="" disabled={Boolean(placeholder)}>{placeholder ?? UNRATED_LABEL}</option>
      {COMPANY_TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
    </NativeSelect>
  );
}

/** Dialog wrapping a form; `onSubmit` returns true to close. */
export function FormDialog({
  trigger,
  title,
  description,
  submitLabel = "Save",
  onSubmit,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  submitLabel?: string;
  onSubmit: (form: FormData) => Promise<boolean>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            start(async () => {
              if (await onSubmit(form)) setOpen(false);
            });
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-3">{children}</div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function num(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `<input type="date">` value → ISO instant at 9am browser-local. */
export function dateInputToIso(v: string | undefined | null): string | null {
  return v ? new Date(`${v}T09:00:00`).toISOString() : null;
}

export function useAction() {
  const [pending, start] = useTransition();
  return { pending, run: (fn: () => Promise<unknown>) => start(async () => void (await fn())) };
}
