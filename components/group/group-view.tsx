"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Archive,
  ArrowRightLeft,
  Calendar,
  Check,
  ChevronRight,
  ExternalLink,
  Flag,
  MoreHorizontal,
  Pencil,
  Plus,
  SkipForward,
  Star,
  StarOff,
} from "lucide-react";
import type { GroupPageData } from "@/lib/services/dashboard";
import type { TaskNode } from "@/lib/domain/next-step";
import { NEXT_LABEL, priorityLabel, SKIP_LABEL_PREFIX, type TaskLite } from "@/lib/todoist/types";
import type { ActionResult } from "@/lib/action-result";
import {
  addTaskAction,
  completeTaskAction,
  moveTaskAction,
  setDueAction,
  setPriorityAction,
  skipTaskAction,
  toggleNextAction,
  updateTaskTitleAction,
} from "@/app/actions/tasks";
import { unwrap } from "@/lib/client/fetcher";
import { formatDate, formatDue } from "@/lib/client/format";
import { COMPLETE_NEXT_EVENT, QUICK_ADD_EVENT } from "@/components/shell/keyboard-shortcuts";
import { GroupDot, GroupIcon } from "@/components/group-icon";
import { EmptyState } from "@/components/states";
import { WeekBlocks } from "./week-blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PRIORITY_COLOR: Record<number, string> = { 4: "#d1453b", 3: "#eb8909", 2: "#246fe0", 1: "transparent" };

/* ---------------------------------------------------------- tree helpers */

function mapTree(nodes: TaskNode[], fn: (n: TaskNode) => TaskNode | null): TaskNode[] {
  const out: TaskNode[] = [];
  for (const n of nodes) {
    const m = fn(n);
    if (m) out.push({ ...m, children: mapTree(m.children, fn) });
  }
  return out;
}

function withoutTask(d: GroupPageData, id: string): GroupPageData {
  const ranked = [d.nextStep, ...d.alternatives].filter((t): t is TaskLite => Boolean(t) && t!.id !== id);
  const tree = mapTree(d.tree, (n) => (n.id === id ? null : n));
  const removed = d.tree.length !== tree.length;
  return {
    ...d,
    tree,
    nextStep: ranked[0] ?? null,
    alternatives: ranked.slice(1, 3),
    counts: { ...d.counts, open: Math.max(0, d.counts.open - (removed ? 1 : 0)) },
  };
}

function patchTask(d: GroupPageData, id: string, patch: Partial<TaskLite>): GroupPageData {
  const p = (t: TaskLite | null) => (t && t.id === id ? { ...t, ...patch } : t);
  return {
    ...d,
    nextStep: p(d.nextStep),
    alternatives: d.alternatives.map((t) => p(t)!),
    tree: mapTree(d.tree, (n) => (n.id === id ? { ...n, ...patch } : n)),
  };
}

/* ------------------------------------------------------------------ view */

/** `top` renders right under the page header (e.g. upcoming interviews); `children` is the context panel at the bottom. */
export function GroupView({ initial, top, children }: { initial: GroupPageData; top?: React.ReactNode; children: React.ReactNode }) {
  const key = `/api/todoist/tasks?group=${encodeURIComponent(initial.group.slug)}`;
  const { data, mutate } = useSWR<GroupPageData>(key, { fallbackData: initial });
  const d = data ?? initial;
  const readOnly = d.group.archived || !d.group.mapped;

  const run = useCallback(
    async (action: () => Promise<ActionResult<unknown>>, optimistic?: (cur: GroupPageData) => GroupPageData, success?: string) => {
      try {
        await mutate(
          async () => {
            unwrap(await action());
            return undefined;
          },
          {
            optimisticData: optimistic ? (cur) => optimistic(cur ?? d) : undefined,
            rollbackOnError: true,
            populateCache: false,
            revalidate: true,
          },
        );
        if (success) toast.success(success);
      } catch {
        /* unwrap already toasted; SWR rolled back */
      }
    },
    [mutate, d],
  );

  const ops: TaskOps = {
    complete: (t) => run(() => completeTaskAction(t.id), (cur) => withoutTask(cur, t.id), `Completed “${truncate(t.content)}”`),
    skip: (t) =>
      run(
        () => skipTaskAction(t.id),
        (cur) => withoutTask(cur, t.id),
        "Skipped for today",
      ),
    rename: (t, content) => run(() => updateTaskTitleAction(t.id, content), (cur) => patchTask(cur, t.id, { content })),
    setDue: (t, due) => run(() => setDueAction(t.id, due), undefined, due ? `Due ${due}` : "Due date cleared"),
    setPriority: (t, p) => run(() => setPriorityAction(t.id, p), (cur) => patchTask(cur, t.id, { priority: p })),
    toggleNext: (t, on) =>
      run(
        () => toggleNextAction(t.id, on),
        (cur) => patchTask(cur, t.id, { labels: on ? [...t.labels, NEXT_LABEL] : t.labels.filter((l) => l !== NEXT_LABEL) }),
        on ? "Marked as next" : undefined,
      ),
    move: (t, slug, name) => run(() => moveTaskAction(t.id, slug), (cur) => withoutTask(cur, t.id), `Moved to ${name}`),
  };

  const add = (content: string, dueString?: string) => {
    const temp: TaskNode = {
      id: `temp-${Date.now()}`,
      content,
      description: "",
      projectId: d.group.todoistProjectId ?? "",
      sectionId: d.group.todoistSectionId,
      parentId: null,
      labels: [],
      priority: 1,
      due: null,
      durationMinutes: null,
      childOrder: 1e9,
      url: "",
      completedAt: null,
      checked: false,
      children: [],
    };
    return run(
      () => addTaskAction({ slug: d.group.slug, content, dueString }),
      (cur) => ({ ...cur, tree: [...cur.tree, temp], nextStep: cur.nextStep ?? temp, counts: { ...cur.counts, open: cur.counts.open + 1 } }),
      "Added to Todoist",
    );
  };

  useEffect(() => {
    const onComplete = () => {
      if (d.nextStep && !readOnly) void ops.complete(d.nextStep);
    };
    window.addEventListener(COMPLETE_NEXT_EVENT, onComplete);
    return () => window.removeEventListener(COMPLETE_NEXT_EVENT, onComplete);
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${d.group.color}1f`, color: d.group.color }}>
            <GroupIcon name={d.group.icon} className="size-5" />
          </span>
          <div>
            <h1 className="text-3xl">{d.group.name}</h1>
            <p className="text-sm text-muted-foreground">
              {d.counts.open} open
              {d.counts.overdue > 0 && <span className="text-destructive"> · {d.counts.overdue} overdue</span>}
              {d.counts.dueToday > 0 && <> · {d.counts.dueToday} due today</>}
            </p>
          </div>
        </div>
        {d.group.archived && (
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            <Archive className="size-3.5" /> Archived · read-only
          </span>
        )}
      </header>

      {!d.group.mapped && (
        <EmptyState title="This group isn't mapped to Todoist yet">
          Pick a Todoist project or section for it in <a href="/settings" className="text-primary underline">Settings</a>, or run{" "}
          <code className="rounded bg-muted px-1">pnpm seed</code>.
        </EmptyState>
      )}

      {top && <section aria-label="Highlights">{top}</section>}

      <NextStepCard data={d} ops={ops} readOnly={readOnly} />

      <WeekBlocks slug={d.group.slug} color={d.group.color} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="todos">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="todos" className="text-xl">To-dos</h2>
            <span className="text-xs text-muted-foreground">Synced with Todoist · refreshes every minute</span>
          </div>
          {!readOnly && <QuickAdd onAdd={add} groupName={d.group.name} />}
          {d.tree.length === 0 ? (
            <EmptyState className="mt-3" title="No open to-dos">
              {readOnly ? "Nothing here." : "Add one above (press n), or capture it in Todoist on your phone; it shows up here within a minute."}
            </EmptyState>
          ) : (
            <ul className="mt-3 divide-y rounded-xl border bg-card">
              {d.tree.map((t) => (
                <TaskRow key={t.id} task={t} today={d.today} ops={ops} readOnly={readOnly} otherGroups={d.otherGroups} depth={0} />
              ))}
            </ul>
          )}
        </section>

        <aside aria-labelledby="done">
          <h2 id="done" className="mb-3 text-xl">Done this week</h2>
          {d.doneThisWeek.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing completed since Monday yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.doneThisWeek.slice(0, 20).map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  <span className="text-muted-foreground line-through decoration-muted-foreground/40">{t.content}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">
                    {formatDate(t.completedAt, { weekday: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <section aria-label="Context">{children}</section>
    </div>
  );
}

type TaskOps = {
  complete: (t: TaskLite) => Promise<void>;
  skip: (t: TaskLite) => Promise<void>;
  rename: (t: TaskLite, content: string) => Promise<void>;
  setDue: (t: TaskLite, due: string | null) => Promise<void>;
  setPriority: (t: TaskLite, p: number) => Promise<void>;
  toggleNext: (t: TaskLite, on: boolean) => Promise<void>;
  move: (t: TaskLite, slug: string, name: string) => Promise<void>;
};

function truncate(s: string, n = 40) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* ------------------------------------------------------------- next step */

function NextStepCard({ data: d, ops, readOnly }: { data: GroupPageData; ops: TaskOps; readOnly: boolean }) {
  const t = d.nextStep;
  const due = t ? formatDue(t, d.today) : null;
  return (
    <section
      aria-labelledby="next-step"
      className="relative overflow-hidden rounded-2xl border bg-card p-5 sm:p-6"
      style={{ boxShadow: `inset 4px 0 0 ${d.group.color}` }}
    >
      <p id="next-step" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Next step
      </p>
      {t ? (
        <>
          <p className="mt-2 font-serif text-2xl leading-snug sm:text-[28px]">{t.content}</p>
          {t.description && <p className="mt-2 line-clamp-3 text-sm whitespace-pre-line text-muted-foreground">{t.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {t.labels.includes(NEXT_LABEL) && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">next</span>}
            {due && <span className={cn(due.tone === "overdue" && "text-destructive")}>{due.tone === "overdue" ? "Overdue · " : ""}{due.label}</span>}
            {t.priority > 1 && <span>{priorityLabel(t.priority)}</span>}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => ops.complete(t)} disabled={readOnly} className="rounded-lg">
              <Check /> Complete <kbd className="ml-1 rounded bg-primary-foreground/20 px-1 text-[10px]">c</kbd>
            </Button>
            <Button variant="outline" onClick={() => ops.skip(t)} disabled={readOnly} className="rounded-lg">
              <SkipForward /> Skip to next
            </Button>
            <Button variant="ghost" asChild className="rounded-lg">
              <a href={t.url} target="_blank" rel="noreferrer">
                <ExternalLink /> Open in Todoist
              </a>
            </Button>
          </div>
          {d.alternatives.length > 0 && (
            <div className="mt-5 border-t pt-3">
              <p className="mb-1 text-xs text-muted-foreground">Then</p>
              <ol className="space-y-0.5 text-sm">
                {d.alternatives.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-muted-foreground">
                    <ChevronRight className="size-3.5" /> {a.content}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 font-serif text-xl text-muted-foreground italic">
          {d.tree.length ? "Everything left is skipped for today." : "Nothing open here. Add a to-do below, or enjoy the break."}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- quick add */

function QuickAdd({ onAdd, groupName }: { onAdd: (content: string, due?: string) => Promise<void>; groupName: string }) {
  const [content, setContent] = useState("");
  const [due, setDue] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => ref.current?.focus();
    window.addEventListener(QUICK_ADD_EVENT, focus);
    return () => window.removeEventListener(QUICK_ADD_EVENT, focus);
  }, []);

  return (
    <form
      className="flex flex-col gap-2 rounded-xl border bg-card p-2 focus-within:ring-2 focus-within:ring-ring/40 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        const c = content.trim();
        if (!c) return;
        void onAdd(c, due.trim() || undefined);
        setContent("");
        setDue("");
      }}
    >
      <div className="flex flex-1 items-center gap-2">
        <Plus className="ml-1 size-4 shrink-0 text-muted-foreground" />
        <input
          ref={ref}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={`Add to ${groupName}…  (press n)`}
          className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          aria-label="New to-do"
          maxLength={500}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          value={due}
          onChange={(e) => setDue(e.target.value)}
          placeholder="Due: tomorrow 3pm"
          className="h-8 w-full rounded-md bg-muted/60 px-2 text-sm outline-none placeholder:text-muted-foreground sm:w-40"
          aria-label="Due date (natural language)"
          maxLength={100}
        />
        <Button type="submit" size="sm" disabled={!content.trim()} className="h-8 rounded-lg">
          Add
        </Button>
      </div>
    </form>
  );
}

/* --------------------------------------------------------------- task row */

function TaskRow({
  task: t,
  today,
  ops,
  readOnly,
  otherGroups,
  depth,
}: {
  task: TaskNode;
  today: string;
  ops: TaskOps;
  readOnly: boolean;
  otherGroups: GroupPageData["otherGroups"];
  depth: number;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.content);
  const due = formatDue(t, today);
  const isNext = t.labels.includes(NEXT_LABEL);
  const skipped = t.labels.includes(`${SKIP_LABEL_PREFIX}${today}`);
  const temp = t.id.startsWith("temp-");

  return (
    <li className={cn(temp && "opacity-60")}>
      <div className="group flex items-start gap-3 px-3 py-2.5" style={{ paddingLeft: `${12 + depth * 24}px` }}>
        <button
          aria-label={`Complete ${t.content}`}
          disabled={readOnly || temp}
          onClick={() => ops.complete(t)}
          className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors hover:bg-muted disabled:opacity-50"
          style={{ borderColor: t.priority > 1 ? PRIORITY_COLOR[t.priority] : undefined }}
        >
          <Check className="size-3 opacity-0 group-hover:opacity-40" />
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setEditing(false);
                if (title.trim() && title.trim() !== t.content) void ops.rename(t, title.trim());
              }}
            >
              <Input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  setEditing(false);
                  if (title.trim() && title.trim() !== t.content) void ops.rename(t, title.trim());
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setTitle(t.content);
                    setEditing(false);
                  }
                }}
                className="h-7 text-sm"
              />
            </form>
          ) : (
            <p
              className={cn("text-sm leading-5", skipped && "text-muted-foreground", !readOnly && "cursor-text")}
              onDoubleClick={() => !readOnly && !temp && setEditing(true)}
            >
              {t.content}
            </p>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {isNext && <span className="rounded-full bg-primary/10 px-1.5 text-primary">next</span>}
            {skipped && <span className="rounded-full bg-muted px-1.5">skipped today</span>}
            {due && (
              <span className={cn("flex items-center gap-1", due.tone === "overdue" && "text-destructive", due.tone === "today" && "text-success")}>
                <Calendar className="size-3" /> {due.label}
              </span>
            )}
            {t.labels
              .filter((l) => l !== NEXT_LABEL && !l.startsWith(SKIP_LABEL_PREFIX))
              .map((l) => (
                <span key={l}>@{l}</span>
              ))}
          </div>
        </div>
        {!readOnly && !temp && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Task actions" className="opacity-60 group-hover:opacity-100">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => ops.complete(t)}>
                <Check /> Complete
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil /> Edit title
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => ops.toggleNext(t, !isNext)}>
                {isNext ? <StarOff /> : <Star />} {isNext ? "Unmark next" : "Mark as next"}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Calendar /> Due date
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {["today", "tomorrow", "next monday", "next week"].map((s) => (
                    <DropdownMenuItem key={s} onSelect={() => ops.setDue(t, s)} disabled={t.due?.isRecurring}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DueDialogItem task={t} onSubmit={(v) => ops.setDue(t, v)} />
                  <DropdownMenuItem onSelect={() => ops.setDue(t, null)} disabled={!t.due || t.due.isRecurring}>
                    Clear due date
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Flag /> Priority
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {[4, 3, 2, 1].map((p) => (
                    <DropdownMenuItem key={p} onSelect={() => ops.setPriority(t, p)}>
                      <Flag style={{ color: PRIORITY_COLOR[p] === "transparent" ? undefined : PRIORITY_COLOR[p] }} />
                      {priorityLabel(p)} {t.priority === p && <Check className="ml-auto" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {otherGroups.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ArrowRightLeft /> Move to
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {otherGroups.map((g) => (
                      <DropdownMenuItem key={g.id} onSelect={() => ops.move(t, g.slug, g.name)}>
                        <GroupDot color={g.color} /> {g.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href={t.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open in Todoist
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {t.children.length > 0 && (
        <ul className="divide-y border-t border-dashed">
          {t.children.map((c) => (
            <TaskRow key={c.id} task={c} today={today} ops={ops} readOnly={readOnly} otherGroups={otherGroups} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DueDialogItem({ task, onSubmit }: { task: TaskLite; onSubmit: (v: string) => void }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen(true); }}>
          {task.due?.isRecurring ? "Move next occurrence…" : "Custom…"}
        </DropdownMenuItem>
      </PopoverTrigger>
      <PopoverContent className="w-64" side="left">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onSubmit(value.trim());
            setOpen(false);
          }}
          className="space-y-2"
        >
          {task.due?.isRecurring ? (
            <>
              <p className="text-xs text-muted-foreground">Recurring ({task.due.string}); pick the next date. The recurrence is kept.</p>
              <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Any Todoist date, e.g. “fri 3pm” or “in 3 days”.</p>
              <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="tomorrow 3pm" />
            </>
          )}
          <Button type="submit" size="sm" className="w-full">Set due date</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
