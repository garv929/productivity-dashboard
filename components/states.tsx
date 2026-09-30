import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  children,
  icon,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-dashed bg-surface/50 px-5 py-8 text-center", className)}>
      {icon && <div className="mx-auto mb-2 flex justify-center text-muted-foreground">{icon}</div>}
      <p className="font-serif text-base">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const e = error as { name?: string; message?: string };
  const rateLimited = e?.name === "TodoistRateLimitError";
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-center gap-2 font-medium text-destructive">
        <AlertTriangle className="size-4" />
        {rateLimited ? "Todoist is rate-limiting" : "Couldn't load this page"}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {rateLimited
          ? "Too many requests to Todoist right now. Refresh in a few seconds."
          : (e?.message ?? "Something went wrong.")}
      </p>
      <p className="mt-3 text-sm">
        Check <Link className="text-primary underline" href="/api/health">/api/health</Link> and your{" "}
        <Link className="text-primary underline" href="/settings">settings</Link>.
      </p>
    </div>
  );
}
