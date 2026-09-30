"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Check, History, Loader2, MessageSquarePlus, Square, Trash2, TriangleAlert, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAssistant } from "./assistant-context";
import { ConfirmationCard } from "./confirmation-card";
import { TOOL_STATUS, WRITE_TOOL_NAMES, type ChatPageContext, type ProposalOutput, type StepPreview } from "@/lib/ai/types";
import type { NavGroup } from "@/components/shell/app-shell";
import { cn } from "@/lib/utils";

const SESSION_KEY = "nsd:chat-session";
const WRITE_TOOLS = new Set<string>(WRITE_TOOL_NAMES);

const SUGGESTIONS = [
  "What should I work on in this block?",
  "Who do I owe a follow-up?",
  "How am I tracking this week?",
  "I didn't finish today's stuff. Clean it up.",
];

function newId() {
  return crypto.randomUUID();
}

export function AssistantPanel({ groups }: { groups: NavGroup[] }) {
  const { open, setOpen } = useAssistant();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!open || sessionId) return;
    const stored = window.localStorage.getItem(SESSION_KEY);
    const id = stored ?? newId();
    if (!stored) window.localStorage.setItem(SESSION_KEY, id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage requires the browser
    setSessionId(id);
  }, [open, sessionId]);

  const switchTo = (id: string) => {
    window.localStorage.setItem(SESSION_KEY, id);
    setSessionId(id);
    setShowHistory(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" showCloseButton={false} className="w-full! gap-0! bg-background p-0 sm:max-w-[36rem]!">
        <SheetTitle className="sr-only">Assistant</SheetTitle>
        <SheetDescription className="sr-only">Ask about your tasks, calendar and job-search records.</SheetDescription>
        <header className="flex h-14 shrink-0 items-center gap-1 border-b px-3">
          <Button variant="ghost" size="icon-sm" onClick={() => setShowHistory((s) => !s)} aria-label="Chat history" aria-pressed={showHistory}>
            <History />
          </Button>
          <p className="ml-1 font-serif text-lg">Assistant</p>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => switchTo(newId())}>
              <MessageSquarePlus /> New chat
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="Close assistant">
              <X />
            </Button>
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1">
          {showHistory && <HistorySidebar current={sessionId} onPick={switchTo} onNew={() => switchTo(newId())} />}
          {sessionId && <ThreadLoader key={sessionId} sessionId={sessionId} groups={groups} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- History */

type SessionRow = { id: string; title: string; updatedAt: string };

function HistorySidebar({ current, onPick, onNew }: { current: string | null; onPick: (id: string) => void; onNew: () => void }) {
  const { data, mutate } = useSWR<{ sessions: SessionRow[] }>("/api/chat/sessions", { refreshInterval: 0 });
  const remove = async (id: string) => {
    await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
    await mutate();
    if (id === current) onNew();
  };
  return (
    <aside className="absolute inset-y-0 left-0 z-10 flex w-64 flex-col border-r bg-surface shadow-lg">
      <p className="px-4 pt-3 pb-2 text-xs font-medium text-muted-foreground">Past chats</p>
      <ul className="flex-1 overflow-y-auto px-2 pb-3">
        {!data && <li className="px-2 py-1 text-sm text-muted-foreground">Loading…</li>}
        {data?.sessions.length === 0 && <li className="px-2 py-1 text-sm text-muted-foreground">No chats yet.</li>}
        {data?.sessions.map((s) => (
          <li key={s.id} className="group flex items-center">
            <button
              onClick={() => onPick(s.id)}
              className={cn(
                "min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent",
                s.id === current && "bg-accent font-medium",
              )}
            >
              {s.title}
            </button>
            <button
              onClick={() => void remove(s.id)}
              className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus:opacity-100"
              aria-label={`Delete chat ${s.title}`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ----------------------------------------------------------------- Thread */

function ThreadLoader({ sessionId, groups }: { sessionId: string; groups: NavGroup[] }) {
  const { data, error } = useSWR<{ messages: UIMessage[] }>(`/api/chat/sessions/${sessionId}`, {
    refreshInterval: 0,
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });
  if (error) return <p className="m-auto p-6 text-sm text-muted-foreground">Couldn&apos;t load this chat.</p>;
  if (!data) {
    return (
      <div className="m-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading chat…
      </div>
    );
  }
  return <Thread sessionId={sessionId} initialMessages={data.messages} groups={groups} />;
}

function usePageContext(): ChatPageContext {
  const pathname = usePathname();
  return useMemo(() => {
    const m = pathname.match(/^\/g\/([^/]+)/);
    return { pathname, groupSlug: m ? decodeURIComponent(m[1]) : null };
  }, [pathname]);
}

function Thread({ sessionId, initialMessages, groups }: { sessionId: string; initialMessages: UIMessage[]; groups: NavGroup[] }) {
  const page = usePageContext();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { open, consumePrompt, pendingPrompt } = useAssistant();

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages, body }) => ({
          body: { id, message: messages[messages.length - 1], page: body?.page },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, stop, clearError } = useChat({
    id: sessionId,
    messages: initialMessages,
    transport,
    onFinish: () => {
      void mutate((key) => typeof key === "string" && (key.startsWith("/api/actions/") || key === "/api/chat/sessions"));
      router.refresh();
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    clearError();
    void sendMessage({ text: t }, { body: { page } });
  };

  useEffect(() => {
    if (open && pendingPrompt && !busy) {
      const p = consumePrompt();
      if (p) void sendMessage({ text: p }, { body: { page } });
    }
  }, [open, pendingPrompt, busy, consumePrompt, sendMessage, page]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const groupName = (slug: unknown) => (typeof slug === "string" ? groups.find((g) => g.slug === slug)?.name : undefined);
  const currentGroup = groupName(page.groupSlug);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {messages.length === 0 ? (
          <div className="mx-auto mt-10 max-w-sm text-center">
            <p className="font-serif text-2xl">How can I help?</p>
            <p className="mt-2 text-sm text-muted-foreground">
              I can read your tasks, calendar and records{currentGroup ? `, starting with ${currentGroup}` : ""}. Changes always wait for your OK.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-xl border bg-card px-4 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-6">
            {messages.map((m, i) => (
              <MessageView
                key={m.id}
                message={m}
                streaming={busy && i === messages.length - 1 && m.role === "assistant"}
                groupName={groupName}
                onFollowUp={send}
              />
            ))}
            {status === "submitted" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Thinking…
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="flex-1">{friendlyError(error)}</p>
              </div>
            )}
          </div>
        )}
      </div>
      <Composer busy={busy} onSend={send} onStop={() => void stop()} placeholder={currentGroup ? `Ask about ${currentGroup}…` : "Ask anything about your job search…"} />
    </div>
  );
}

function friendlyError(err: Error): string {
  try {
    const parsed = JSON.parse(err.message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {}
  return err.message || "Something went wrong. Please try again.";
}

/* --------------------------------------------------------------- Messages */

type ToolPartLike = { type: string; state?: string; input?: Record<string, unknown>; output?: unknown; errorText?: string; toolCallId?: string };

function MessageView({
  message,
  streaming,
  groupName,
  onFollowUp,
}: {
  message: UIMessage;
  streaming: boolean;
  groupName: (slug: unknown) => string | undefined;
  onFollowUp: (text: string) => void;
}) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap text-secondary-foreground">{text}</div>
      </div>
    );
  }

  const proposals = new Map<string, StepPreview[]>();
  for (const p of message.parts as ToolPartLike[]) {
    if (!p.type.startsWith("tool-") || p.state !== "output-available") continue;
    if (!WRITE_TOOLS.has(p.type.slice(5))) continue;
    const out = p.output as ProposalOutput;
    if (out && "pendingActionId" in out) proposals.set(out.pendingActionId, out.steps);
  }

  return (
    <div className="space-y-3">
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          if (!part.text.trim()) return null;
          return (
            <div key={i} className="prose-claude font-serif text-[15px] leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          );
        }
        if (part.type.startsWith("tool-")) return <ToolLine key={i} part={part as ToolPartLike} groupName={groupName} />;
        return null;
      })}
      {streaming && message.parts.every((p) => p.type !== "text") && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Working…
        </div>
      )}
      {!streaming &&
        Array.from(proposals.entries()).map(([id, steps]) => <ConfirmationCard key={id} id={id} initialSteps={steps} onFollowUp={onFollowUp} />)}
    </div>
  );
}

function toolLabel(name: string, input: Record<string, unknown> | undefined, groupName: (slug: unknown) => string | undefined) {
  const g = groupName(input?.group);
  if (name === "get_tasks" && g) return `Checking your ${g} tasks`;
  if (name === "get_next_step" && g) return `Finding the next step in ${g}`;
  if (name === "search" && typeof input?.query === "string") return `Searching for “${input.query}”`;
  if (name === "create_tasks" && g) return `Drafting tasks for ${g}`;
  return TOOL_STATUS[name] ?? name.replace(/_/g, " ");
}

function ToolLine({ part, groupName }: { part: ToolPartLike; groupName: (slug: unknown) => string | undefined }) {
  const name = part.type.slice(5);
  const label = toolLabel(name, part.input, groupName);
  const running = part.state === "input-streaming" || part.state === "input-available";
  const out = part.output as { error?: string } | undefined;
  const failed = part.state === "output-error" || Boolean(out && typeof out === "object" && "error" in out && out.error);
  return (
    <div className="flex items-center gap-1.5 font-sans text-xs text-muted-foreground">
      {running ? (
        <Loader2 className="size-3 animate-spin" />
      ) : failed ? (
        <TriangleAlert className="size-3 text-warning" />
      ) : (
        <Check className="size-3 text-muted-foreground/70" />
      )}
      <span>
        {label}
        {running ? "…" : ""}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- Composer */

function Composer({ busy, onSend, onStop, placeholder }: { busy: boolean; onSend: (t: string) => void; onStop: () => void; placeholder: string }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const { open } = useAssistant();

  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const submit = () => {
    if (!value.trim() || busy) return;
    onSend(value);
    setValue("");
  };

  return (
    <div className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
      <form
        className="mx-auto flex max-w-2xl items-end gap-2 rounded-3xl border bg-card p-2 pl-4 shadow-sm focus-within:border-primary/40"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label="Message the assistant"
          className="max-h-44 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        {busy ? (
          <Button type="button" size="icon" variant="secondary" className="rounded-full" onClick={onStop} aria-label="Stop">
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" className="rounded-full" disabled={!value.trim()} aria-label="Send">
            <ArrowUp />
          </Button>
        )}
      </form>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Changes always wait for your confirmation. Enter to send, Shift+Enter for a new line.</p>
    </div>
  );
}
