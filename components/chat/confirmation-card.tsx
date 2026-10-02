"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Ban, Check, CircleAlert, Clock, Loader2, RotateCcw, Undo2, X } from "lucide-react";
import type { PendingActionView, StepPreview, StepDetails } from "@/lib/ai/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmResponse =
  | { outcome: "executed" | "failed"; action: PendingActionView }
  | { outcome: "stale"; reason: string; action: PendingActionView }
  | { outcome: "rejected"; reason: string; status: string };

async function post<T>(url: string): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(url, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body };
}

function Inline({ text }: { text: string }) {
  return (
    <ReactMarkdown allowedElements={["strong", "em", "p", "code"]} unwrapDisallowed components={{ p: ({ children }) => <>{children}</> }}>
      {text}
    </ReactMarkdown>
  );
}

export function ConfirmationCard({
  id,
  initialSteps,
  onFollowUp,
}: {
  id: string;
  initialSteps: StepPreview[];
  /** Sends a message back to the assistant (e.g. to re-propose after a stale confirmation). */
  onFollowUp: (text: string) => void;
}) {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const { data, mutate } = useSWR<PendingActionView>(`/api/actions/${id}`, { refreshInterval: 0, revalidateOnFocus: false });
  const [busy, setBusy] = useState<null | "confirm" | "cancel" | "undo" | "retry">(null);
  const [retryId, setRetryId] = useState<string | null>(null);

  const view = data;
  const status = view?.status ?? "awaiting_confirmation";
  const steps = view?.steps ?? initialSteps;

  const refreshData = () => {
    void globalMutate((key) => typeof key === "string" && !key.startsWith("/api/actions") && !key.startsWith("/api/chat"));
    router.refresh();
  };

  const confirm = async () => {
    setBusy("confirm");
    try {
      const { body } = await post<ConfirmResponse>(`/api/actions/${id}/confirm`);
      if (body.outcome === "rejected") {
        toast.error(body.reason);
        await mutate();
        return;
      }
      await mutate(body.action, { revalidate: false });
      refreshData();
      if (body.outcome === "executed") toast.success(body.action.steps.length > 1 ? `Done: ${body.action.steps.length} changes` : "Done");
      if (body.outcome === "failed") toast.error("Some steps didn't go through");
      if (body.outcome === "stale") {
        onFollowUp(`That didn't go through because something changed: ${body.reason} Please take another look and propose an updated action.`);
      }
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy("cancel");
    try {
      const { ok, body } = await post<{ reason?: string }>(`/api/actions/${id}/cancel`);
      if (!ok) toast.error(body.reason ?? "Couldn't cancel");
      await mutate();
    } finally {
      setBusy(null);
    }
  };

  const undo = async () => {
    setBusy("undo");
    try {
      const { ok, body } = await post<{ reason?: string; errors?: string[]; undoneSteps?: number }>(`/api/actions/${id}/undo`);
      if (!ok) toast.error(body.reason ?? "Couldn't undo");
      else if (body.errors?.length) toast.error(`Undid ${body.undoneSteps} step(s); ${body.errors.length} couldn't be undone`, { description: body.errors.join("\n") });
      else toast.success("Undone");
      await mutate();
      refreshData();
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy("retry");
    try {
      const { ok, body } = await post<{ reason?: string; action?: PendingActionView }>(`/api/actions/${id}/retry`);
      if (!ok || !body.action) toast.error(body.reason ?? "Couldn't retry");
      else setRetryId(body.action.id);
    } finally {
      setBusy(null);
    }
  };

  const resultFor = (i: number) => view?.results.find((r) => r.index === i);
  const anyUndoable = (view?.results ?? []).some((r) => r.undoable);
  const expired = status === "expired";
  const awaiting = status === "awaiting_confirmation";

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "rounded-2xl border bg-surface p-4 font-sans shadow-xs",
          awaiting && "border-primary/30",
          (status === "cancelled" || expired || view?.undone) && "opacity-70",
        )}
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <StatusBadge status={status} stale={Boolean(view?.stale)} undone={Boolean(view?.undone)} />
          <span className="ml-auto">{steps.length > 1 ? `${steps.length} changes, run in order` : "1 change"}</span>
        </div>
        <ol className="space-y-1.5 text-sm">
          {steps.map((s, i) => {
            const r = resultFor(i);
            const skipped = status === "failed" && view?.failedIndex !== null && view && i > (view.failedIndex ?? 0);
            return (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 shrink-0">
                  {r?.ok ? (
                    <Check className="size-4 text-success" />
                  ) : r && !r.ok ? (
                    <CircleAlert className="size-4 text-destructive" />
                  ) : (
                    <span className="flex size-4 items-center justify-center rounded-full border text-[10px] text-muted-foreground">{i + 1}</span>
                  )}
                </span>
                <div className={cn("min-w-0", skipped && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                  <Inline text={r?.summary ?? s.summary} />
                  {r?.error && <p className="mt-0.5 text-xs text-destructive">{r.error}</p>}
                  {s.details && !r && <DetailsTable details={s.details} />}
                </div>
              </li>
            );
          })}
        </ol>
        {view?.stale && view.error && <p className="mt-2 text-xs text-muted-foreground">{view.error}</p>}

        {awaiting && (
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={confirm} disabled={busy !== null}>
              {busy === "confirm" ? <Loader2 className="animate-spin" /> : <Check />} Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel} disabled={busy !== null}>
              {busy === "cancel" ? <Loader2 className="animate-spin" /> : <X />} Cancel
            </Button>
          </div>
        )}
        {expired && (
          <div className="mt-3 flex items-center gap-2">
            <p className="text-xs text-muted-foreground">Proposals expire after 10 minutes.</p>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => onFollowUp("That proposal expired. Please check the details again and re-propose it.")}>
              Re-propose
            </Button>
          </div>
        )}
        {(status === "executed" || status === "failed") && !view?.stale && (
          <div className="mt-4 flex flex-wrap gap-2">
            {status === "failed" && !retryId && (
              <Button size="sm" variant="outline" onClick={retry} disabled={busy !== null}>
                {busy === "retry" ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry remaining steps
              </Button>
            )}
            {anyUndoable && !view?.undone && (
              <Button size="sm" variant="ghost" onClick={undo} disabled={busy !== null}>
                {busy === "undo" ? <Loader2 className="animate-spin" /> : <Undo2 />} Undo {status === "failed" ? "completed steps" : ""}
              </Button>
            )}
          </div>
        )}
      </div>
      {retryId && <ConfirmationCard id={retryId} initialSteps={[]} onFollowUp={onFollowUp} />}
    </div>
  );
}

function StatusBadge({ status, stale, undone }: { status: PendingActionView["status"]; stale: boolean; undone: boolean }) {
  if (undone) return <span className="flex items-center gap-1"><Undo2 className="size-3.5" /> Undone</span>;
  switch (status) {
    case "awaiting_confirmation":
      return <span className="flex items-center gap-1 text-primary"><Clock className="size-3.5" /> Waiting for your OK</span>;
    case "executing":
      return <span className="flex items-center gap-1"><Loader2 className="size-3.5 animate-spin" /> Running…</span>;
    case "executed":
      return <span className="flex items-center gap-1 text-success"><Check className="size-3.5" /> Done</span>;
    case "failed":
      return <span className="flex items-center gap-1 text-destructive"><CircleAlert className="size-3.5" /> {stale ? "Out of date" : "Partly failed"}</span>;
    case "cancelled":
      return <span className="flex items-center gap-1"><Ban className="size-3.5" /> Cancelled</span>;
    case "expired":
      return <span className="flex items-center gap-1"><Clock className="size-3.5" /> Expired</span>;
  }
}

/** Scrollable preview of a step's rows (e.g. every company in an import). */
function DetailsTable({ details }: { details: StepDetails }) {
  return (
    <div className="mt-2 space-y-1.5">
      <div className="max-h-64 overflow-auto rounded-lg border bg-card">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-card text-muted-foreground">
            <tr>
              {details.columns.map((c, i) => (
                <th key={i} className="border-b px-2 py-1.5 font-medium whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {details.rows.map((row, i) => (
              <tr key={i} className={cn(row[0] === "Skip" && "text-muted-foreground")}>
                {row.map((cell, j) => (
                  <td key={j} className={cn("px-2 py-1 align-top", j <= 1 ? "font-medium whitespace-nowrap" : "max-w-48 truncate")} title={cell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {details.note && <p className="text-[11px] text-muted-foreground">{details.note}</p>}
    </div>
  );
}
