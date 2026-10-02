import "server-only";
import { tool } from "ai";
import Fuse from "fuse.js";
import { z } from "zod";
import { listOpenTasks } from "@/lib/todoist";
import { groupForTask } from "@/lib/domain/group-mapping";
import { listApplications } from "@/lib/services/applications";
import { listContacts } from "@/lib/services/contacts";
import { listCompanies } from "@/lib/services/companies";
import { listInterviews } from "@/lib/services/prep";
import { listIncomeOptions } from "@/lib/services/income";
import { listFocusItems } from "@/lib/services/focus";
import { localDate } from "@/lib/domain/time";
import { dueLocal, fail, untrusted, type ToolCtx } from "../context";

type Doc = { type: string; id: string; title: string; detail: string; extra?: Record<string, unknown> };

const TYPES = ["task", "application", "contact", "company", "interview", "income_option", "focus_item"] as const;

export function searchTool(tc: ToolCtx) {
  return {
    search: tool({
      description:
        "Fuzzy search across open task titles (dashboard groups only) and every record type (applications, contacts, companies, interviews, income options, focus items). Returns typed matches with IDs. Use it to resolve names like “Ramp” or “Priya” before writing.",
      inputSchema: z.object({
        query: z.string().min(1).max(100),
        types: z.array(z.enum(TYPES)).optional(),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      execute: async ({ query, types, limit }) => {
        try {
          const want = new Set(types ?? TYPES);
          const [groups, tasks, apps, contacts, companies, interviews, options, focus] = await Promise.all([
            tc.groups(),
            want.has("task") ? listOpenTasks() : [],
            want.has("application") ? listApplications(tc.userId) : [],
            want.has("contact") ? listContacts(tc.userId, { now: tc.now }) : [],
            want.has("company") ? listCompanies(tc.userId) : [],
            want.has("interview") ? listInterviews(tc.userId, { upcomingOnly: true, now: tc.now }) : [],
            want.has("income_option") ? listIncomeOptions(tc.userId) : [],
            want.has("focus_item") ? listFocusItems(tc.userId) : [],
          ]);
          const active = groups.filter((g) => !g.archivedAt);
          const docs: Doc[] = [];
          for (const t of tasks) {
            const g = groupForTask(t, active);
            if (!g) continue;
            docs.push({ type: "task", id: t.id, title: t.content, detail: t.description, extra: { group: g.slug, due: dueLocal(t, tc.tz), recurring: t.due?.isRecurring ?? false } });
          }
          for (const a of apps) docs.push({ type: "application", id: a.id, title: `${a.companyName} – ${a.role}`, detail: a.notes ?? "", extra: { stage: a.stage } });
          for (const c of contacts) docs.push({ type: "contact", id: c.id, title: c.name, detail: [c.company, c.notes].filter(Boolean).join(" "), extra: { company: c.company } });
          for (const c of companies) docs.push({ type: "company", id: c.id, title: c.name, detail: [c.rolesOfInterest, c.why].filter(Boolean).join(" "), extra: { status: c.status, tier: c.tier ?? "unrated" } });
          for (const i of interviews)
            docs.push({ type: "interview", id: i.id, title: `${i.companyName ?? "Interview"}${i.role ? ` – ${i.role}` : ""}`, detail: i.stage ?? "", extra: { date: localDate(i.scheduledAt, tc.tz) } });
          for (const o of options) docs.push({ type: "income_option", id: o.id, title: o.name, detail: o.verdictNotes ?? "", extra: { status: o.status } });
          for (const f of focus) docs.push({ type: "focus_item", id: f.id, title: f.title, detail: f.goal ?? "", extra: { status: f.status } });

          const fuse = new Fuse(docs, {
            keys: [
              { name: "title", weight: 0.8 },
              { name: "detail", weight: 0.2 },
            ],
            threshold: 0.38,
            ignoreLocation: true,
            includeScore: true,
          });
          const hits = fuse.search(query, { limit });
          return untrusted({
            query,
            matches: hits.map((h) => ({ type: h.item.type, id: h.item.id, title: h.item.title, score: Math.round((1 - (h.score ?? 0)) * 100) / 100, ...h.item.extra })),
          });
        } catch (err) {
          return fail(err);
        }
      },
    }),
  };
}
