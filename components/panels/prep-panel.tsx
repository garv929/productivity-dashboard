"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { CalendarPlus, Dumbbell, Eye, Pencil, Plus } from "lucide-react";
import type { PanelData } from "@/lib/services/panels";
import type { StoryKind } from "@/lib/db/schema";
import { addQuestionAction, logPrepSessionAction, saveInterviewAction, saveStoryAction, setPracticedAction } from "@/app/actions/records";
import { unwrap } from "@/lib/client/fetcher";
import { formatDate, relativeDays, toDatetimeLocal } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/states";
import { Field, FormDialog, NativeSelect, PanelHeader, str, useAction, WeeklyCounter } from "./shared";

type Data = Extract<PanelData, { kind: "prep" }>;

const STORY_KINDS: { value: StoryKind; label: string }[] = [
  { value: "30s", label: "30-second" },
  { value: "interview", label: "Interview" },
  { value: "networking", label: "Networking" },
  { value: "followups", label: "Follow-up Q&A" },
];

/** Question bank and stories; upcoming interviews render separately at the top of the page. */
export function PrepPanel({ data, readOnly }: { data: Data; readOnly: boolean }) {
  return (
    <div className="space-y-8">
      <QuestionBank data={data} readOnly={readOnly} />
      <Stories data={data} readOnly={readOnly} />
    </div>
  );
}

/** Shown first on the Interview Prep page: the next interviews, soonest first. */
export function UpcomingInterviews({ data, readOnly, color }: { data: Data; readOnly: boolean; color: string }) {
  const { run, pending } = useAction();
  return (
    <div>
      <PanelHeader title="Upcoming interviews">
        <WeeklyCounter label="prep sessions" actual={data.weekly.actual} min={data.weekly.target} color={color} />
        {!readOnly && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(async () => {
                try {
                  unwrap(await logPrepSessionAction());
                  toast.success("Prep session logged");
                } catch {}
              })
            }
          >
            <Dumbbell /> Log prep session
          </Button>
        )}
        {!readOnly && <InterviewDialog applications={data.applications} trigger={<Button size="sm"><CalendarPlus /> Add</Button>} />}
      </PanelHeader>
      {data.interviews.length === 0 ? (
        <EmptyState title="No interviews scheduled">
          Add one, or tell the assistant “I have an Anthropic screen Thursday at 2pm.”
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.interviews.map((iv) => (
            <li key={iv.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{iv.companyName ?? "Interview"}{iv.role ? ` – ${iv.role}` : ""}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(iv.scheduledAt, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {relativeDays(iv.scheduledAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">{[iv.stage, iv.interviewer].filter(Boolean).join(" · ")}</p>
                </div>
                {!readOnly && (
                  <InterviewDialog
                    interview={iv}
                    applications={data.applications}
                    trigger={<Button variant="ghost" size="icon-sm" aria-label="Edit interview"><Pencil /></Button>}
                  />
                )}
              </div>
              {iv.prepNotes && <p className="mt-2 text-sm whitespace-pre-line">{iv.prepNotes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestionBank({ data, readOnly }: { data: Data; readOnly: boolean }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const { run, pending } = useAction();
  const unpracticed = data.questions.filter((x) => !x.practicedAt).length;
  return (
    <div>
      <PanelHeader title="Question bank">
        <span className="text-sm text-muted-foreground">{unpracticed} not yet practiced</span>
      </PanelHeader>
      {!readOnly && (
        <form
          className="mb-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!q.trim()) return;
            run(async () => {
              try {
                unwrap(await addQuestionAction({ question: q.trim(), category: cat.trim() || undefined }));
                setQ("");
              } catch {}
            });
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Why did you leave Pointer?" className="flex-1" />
          <Input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Category" className="sm:w-40" />
          <Button type="submit" size="sm" className="h-8" disabled={pending || !q.trim()}><Plus /> Add</Button>
        </form>
      )}
      {data.questions.length === 0 ? (
        <EmptyState title="No questions yet">Add the questions you expect, then tick them off as you practice them out loud.</EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {data.questions.map((x) => (
            <li key={x.id} className="flex items-center gap-3 px-3 py-2">
              <Checkbox
                checked={Boolean(x.practicedAt)}
                disabled={readOnly}
                onCheckedChange={(v) => run(async () => { try { unwrap(await setPracticedAction(x.id, Boolean(v))); } catch {} })}
                aria-label={`Practiced: ${x.question}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{x.question}</p>
                <p className="text-xs text-muted-foreground">
                  {[x.category, x.practicedAt ? `practiced ${relativeDays(x.practicedAt)}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stories({ data, readOnly }: { data: Data; readOnly: boolean }) {
  return (
    <div>
      <PanelHeader title="Stories" />
      <Tabs defaultValue="30s">
        <TabsList>
          {STORY_KINDS.map((k) => <TabsTrigger key={k.value} value={k.value}>{k.label}</TabsTrigger>)}
        </TabsList>
        {STORY_KINDS.map((k) => (
          <TabsContent key={k.value} value={k.value}>
            <StoryEditor kind={k.value} label={k.label} initial={data.stories.find((s) => s.kind === k.value)?.bodyMd ?? ""} readOnly={readOnly} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function StoryEditor({ kind, label, initial, readOnly }: { kind: StoryKind; label: string; initial: string; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(initial);
  const { run, pending } = useAction();
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm text-muted-foreground">{label} version · Markdown</p>
        {!readOnly && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing((e) => !e)}>
            {editing ? <><Eye /> Preview</> : <><Pencil /> Edit</>}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="font-mono text-sm" />
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(async () => {
                try {
                  unwrap(await saveStoryAction(kind, body));
                  toast.success("Story saved");
                  setEditing(false);
                } catch {}
              })
            }
          >
            Save
          </Button>
        </div>
      ) : body.trim() ? (
        <div className="prose-claude">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">No {label.toLowerCase()} version yet. Click Edit to write it.</p>
      )}
    </div>
  );
}

function InterviewDialog({
  trigger,
  interview: iv,
  applications,
}: {
  trigger: React.ReactNode;
  interview?: Data["interviews"][number];
  applications: Data["applications"];
}) {
  return (
    <FormDialog
      trigger={trigger}
      title={iv ? "Edit interview" : "Add interview"}
      onSubmit={async (f) => {
        const when = str(f, "scheduledAt");
        if (!when) return false;
        try {
          unwrap(
            await saveInterviewAction({
              id: iv?.id,
              applicationId: str(f, "applicationId") ?? null,
              scheduledAt: new Date(when).toISOString(),
              stage: str(f, "stage"),
              interviewer: str(f, "interviewer"),
              prepNotes: str(f, "prepNotes"),
            }),
          );
          toast.success("Interview saved");
          return true;
        } catch {
          return false;
        }
      }}
    >
      <Field label="Application">
        <NativeSelect name="applicationId" defaultValue={iv?.applicationId ?? ""}>
          <option value="">— none —</option>
          {applications.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </NativeSelect>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date & time"><Input name="scheduledAt" type="datetime-local" required defaultValue={toDatetimeLocal(iv?.scheduledAt)} /></Field>
        <Field label="Stage"><Input name="stage" defaultValue={iv?.stage ?? ""} placeholder="Recruiter screen" /></Field>
      </div>
      <Field label="Interviewer"><Input name="interviewer" defaultValue={iv?.interviewer ?? ""} /></Field>
      <Field label="Prep notes"><Textarea name="prepNotes" rows={4} defaultValue={iv?.prepNotes ?? ""} /></Field>
    </FormDialog>
  );
}
