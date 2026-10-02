"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Check, FileSpreadsheet, FileText, History, Loader2, MessageSquarePlus, Paperclip, Square, Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "./assistant-context";
import { ConfirmationCard } from "./confirmation-card";
import { TOOL_STATUS, WRITE_TOOL_NAMES, type ChatPageContext, type ProposalOutput, type StepPreview } from "@/lib/ai/types";
import type { NavGroup } from "@/components/shell/app-shell";
import { ACCEPTED_EXTENSIONS, ATTACHMENT_LIMITS } from "@/lib/domain/attachments";
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

  if (!open) return null;

  const switchTo = (id: string) => {
    window.localStorage.setItem(SESSION_KEY, id);
    setSessionId(id);
    setShowHistory(false);
  };

  return (
    // Docked column beside the page on desktop (the page stays usable); full screen on phones.
    <aside
      aria-label="Assistant"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
      }}
      className="fixed inset-0 z-40 flex flex-col bg-background lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-[26rem] lg:shrink-0 lg:border-l xl:w-[30rem]"
    >
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
    </aside>
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
  const send = (text: string, files: FileUIPart[] = []) => {
    const t = text.trim();
    if ((!t && files.length === 0) || busy) return;
    clearError();
    void sendMessage({ text: t, files }, { body: { page } });
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
    const files = message.parts.filter((p): p is FileUIPart => p.type === "file");
    return (
      <div className="flex flex-col items-end gap-1.5">
        {files.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {files.map((f, i) => (
              <AttachmentChip key={i} name={f.filename ?? "Attachment"} />
            ))}
          </div>
        )}
        {text.trim() && (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap text-secondary-foreground">{text}</div>
        )}
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

function AttachmentChip({ name, detail, state, onRemove }: { name: string; detail?: string; state?: "reading" | "error"; onRemove?: () => void }) {
  const Icon = /\.(xlsx|xlsm|csv|tsv)$/i.test(name) ? FileSpreadsheet : FileText;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-card px-2 py-1 font-sans text-xs",
        state === "error" && "border-destructive/40 text-destructive",
      )}
    >
      {state === "reading" ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="truncate">{name}</span>
      {detail && <span className="shrink-0 text-muted-foreground">· {detail}</span>}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 rounded text-muted-foreground hover:text-foreground" aria-label={`Remove ${name}`}>
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

type PendingAttachment = { id: string; name: string; state: "reading" | "ready" | "error"; detail?: string; part?: FileUIPart };

type Extracted = { filename: string; text: string; summary: string; truncated: boolean };

/** Reads the file on the server and returns it as a text attachment for the next message. */
async function readAttachment(file: File): Promise<{ part: FileUIPart; detail: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/chat/attachments", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as Partial<Extracted> & { message?: string; error?: string };
  if (!res.ok || typeof body.text !== "string") throw new Error(body.message ?? body.error ?? "Couldn't read that file.");
  return {
    part: { type: "file", mediaType: "text/plain", filename: body.filename ?? file.name, url: `data:text/plain;charset=utf-8,${encodeURIComponent(body.text)}` },
    detail: `${body.summary ?? "read"}${body.truncated ? " (partly)" : ""}`,
  };
}

function Composer({ busy, onSend, onStop, placeholder }: { busy: boolean; onSend: (t: string, files: FileUIPart[]) => void; onStop: () => void; placeholder: string }) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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

  const addFiles = (list: FileList | File[]) => {
    const room = ATTACHMENT_LIMITS.maxFiles - attachments.length;
    for (const file of Array.from(list).slice(0, Math.max(0, room))) {
      const id = newId();
      setAttachments((cur) => [...cur, { id, name: file.name, state: "reading" }]);
      readAttachment(file).then(
        ({ part, detail }) => setAttachments((cur) => cur.map((a) => (a.id === id ? { ...a, state: "ready", part, detail } : a))),
        (err: Error) => setAttachments((cur) => cur.map((a) => (a.id === id ? { ...a, state: "error", detail: err.message } : a))),
      );
    }
  };

  const ready = attachments.filter((a) => a.state === "ready" && a.part);
  const reading = attachments.some((a) => a.state === "reading");
  const canSend = !busy && !reading && (value.trim().length > 0 || ready.length > 0);

  const submit = () => {
    if (!canSend) return;
    onSend(value, ready.map((a) => a.part!));
    setValue("");
    setAttachments([]);
  };

  return (
    <div className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
      <form
        className={cn(
          "mx-auto max-w-2xl rounded-3xl border bg-card p-2 shadow-sm focus-within:border-primary/40",
          dragging && "border-primary/60 bg-primary/[0.03]",
        )}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2 pt-1 pb-2">
            {attachments.map((a) => (
              <AttachmentChip
                key={a.id}
                name={a.name}
                detail={a.detail}
                state={a.state === "ready" ? undefined : a.state}
                onRemove={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
              />
            ))}
          </div>
        )}
        <div className="flex items-end gap-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS.join(",")}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="rounded-full text-muted-foreground"
            onClick={() => fileInput.current?.click()}
            disabled={attachments.length >= ATTACHMENT_LIMITS.maxFiles}
            aria-label="Attach a file"
            title="Attach a file (Excel, CSV, Word, PDF, text · up to 3 MB)"
          >
            <Paperclip className="size-4" />
          </Button>
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
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            placeholder={attachments.length ? "Say what to do with the file…" : placeholder}
            aria-label="Message the assistant"
            className="max-h-44 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          {busy ? (
            <Button type="button" size="icon" variant="secondary" className="rounded-full" onClick={onStop} aria-label="Stop">
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon" className="rounded-full" disabled={!canSend} aria-label="Send">
              {reading ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          )}
        </div>
      </form>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
        Changes always wait for your confirmation. Attach Excel, CSV, Word, PDF or text files with 📎 or drag and drop.
      </p>
    </div>
  );
}
