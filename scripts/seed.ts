/**
 * Idempotent first-run seed (`pnpm seed`):
 *  - upserts the owner user (ALLOWED_EMAIL) so Google sign-in links to it,
 *  - finds or creates the Todoist "Job Search" project + 5 sections, and the
 *    "Side Income" and "Personal Development" projects (never touches the Inbox
 *    or any other existing project; nothing is renamed, moved or deleted),
 *  - inserts the 7 default groups, default weekly targets and empty stories.
 * Re-running creates nothing new and never overwrites edits made in Settings.
 */
import "./load-env";
import { and, eq, isNull } from "drizzle-orm";
import type { TodoistApi } from "@doist/todoist-sdk";
import { db } from "@/lib/db";
import { groups, stories, users, weeklyTargets, type CalendarMatchRule, type GroupKind } from "@/lib/db/schema";
import { collectAll, todoistClient } from "@/lib/todoist/client";
import { METRICS } from "@/lib/domain/scorecard";

type Location = { project: string; section?: string };
type SeedGroup = {
  slug: string;
  name: string;
  kind: GroupKind;
  color: string;
  icon: string;
  location: Location;
  calendarMatch: CalendarMatchRule[];
};

const JOB_SEARCH = "Job Search";

const DEFAULT_GROUPS: SeedGroup[] = [
  {
    slug: "positioning",
    name: "Phase 1 – Positioning",
    kind: "plain",
    color: "#8E24AA",
    icon: "target",
    location: { project: JOB_SEARCH, section: "Phase 1 – Positioning" },
    calendarMatch: [{ type: "startsWith", value: "Phase 1:" }],
  },
  {
    slug: "applications",
    name: "Applications",
    kind: "pipeline",
    color: "#3F51B5",
    icon: "briefcase",
    location: { project: JOB_SEARCH, section: "Applications" },
    calendarMatch: [{ type: "equals", value: "Recruiting: Applications" }],
  },
  {
    slug: "networking",
    name: "Networking & Follow-ups",
    kind: "people",
    color: "#039BE5",
    icon: "users",
    location: { project: JOB_SEARCH, section: "Networking & Follow-ups" },
    calendarMatch: [
      { type: "equals", value: "Recruiting: Networking & outreach" },
      { type: "equals", value: "Follow-ups & inbox" },
    ],
  },
  {
    slug: "interview-prep",
    name: "Interview Prep",
    kind: "prep",
    color: "#3F51B5",
    icon: "mic",
    location: { project: JOB_SEARCH, section: "Interview Prep" },
    calendarMatch: [{ type: "equals", value: "Recruiting: Interview prep" }],
  },
  {
    slug: "company-research",
    name: "Company Research",
    kind: "research",
    color: "#3F51B5",
    icon: "building",
    location: { project: JOB_SEARCH, section: "Company Research" },
    calendarMatch: [{ type: "equals", value: "Recruiting: Company research" }],
  },
  {
    slug: "side-income",
    name: "Side Income",
    kind: "options",
    color: "#F6BF26",
    icon: "dollar-sign",
    location: { project: "Side Income" },
    calendarMatch: [{ type: "equals", value: "What's something you want to do to make some cash?" }],
  },
  {
    slug: "personal-dev",
    name: "Personal Development",
    kind: "focus",
    color: "#7986CB",
    icon: "sprout",
    location: { project: "Personal Development" },
    calendarMatch: [{ type: "equals", value: "Personal development" }],
  },
];

const STORY_TEMPLATES = {
  "30s": "## 30-second version\n\n_Who I am, what I've done, what I'm looking for, in three sentences._\n",
  interview: "## Interview version\n\n- **Context:**\n- **What I did:**\n- **Result:**\n- **Why this role:**\n",
  networking: "## Networking version\n\n_Friendly, specific, ends with a clear ask._\n",
  followups: "## Likely follow-up questions\n\n- Why did you leave?\n  - \n- What would your last manager say?\n  - \n",
} as const;

const norm = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const log = (msg: string) => console.log(`  ${msg}`);

async function ensureProject(api: TodoistApi, name: string, cache: { id: string; name: string; inbox: boolean }[]) {
  const found = cache.find((p) => !p.inbox && norm(p.name) === norm(name));
  if (found) {
    log(`✓ project “${name}” exists`);
    return found.id;
  }
  const created = await api.addProject({ name });
  cache.push({ id: created.id, name: created.name, inbox: false });
  log(`+ created project “${name}”`);
  return created.id;
}

async function ensureSection(api: TodoistApi, projectId: string, name: string, cache: Map<string, { id: string; name: string }[]>) {
  let list = cache.get(projectId);
  if (!list) {
    list = (await collectAll((cursor) => api.getSections({ projectId, cursor, limit: 200 }))).map((s) => ({ id: s.id, name: s.name }));
    cache.set(projectId, list);
  }
  const found = list.find((s) => norm(s.name) === norm(name));
  if (found) {
    log(`✓ section “${name}” exists`);
    return found.id;
  }
  const created = await api.addSection({ name, projectId });
  list.push({ id: created.id, name: created.name });
  log(`+ created section “${name}”`);
  return created.id;
}

async function main() {
  const email = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("ALLOWED_EMAIL is not set (.env.local).");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (.env.local).");
  if (!process.env.TODOIST_API_TOKEN) throw new Error("TODOIST_API_TOKEN is not set (.env.local).");

  console.log("\nOwner");
  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user) log(`✓ user ${email} exists`);
  else {
    [user] = await db.insert(users).values({ email, name: email.split("@")[0] }).returning();
    log(`+ created user ${email}`);
  }

  console.log("\nTodoist");
  const api = todoistClient();
  const projects = (await collectAll((cursor) => api.getProjects({ cursor, limit: 200 }))).map((p) => ({
    id: p.id,
    name: p.name,
    inbox: "inboxProject" in p ? Boolean(p.inboxProject) : false,
  }));
  const sectionCache = new Map<string, { id: string; name: string }[]>();
  const resolved = new Map<string, { projectId: string; sectionId: string | null }>();
  for (const g of DEFAULT_GROUPS) {
    const projectId = await ensureProject(api, g.location.project, projects);
    const sectionId = g.location.section ? await ensureSection(api, projectId, g.location.section, sectionCache) : null;
    resolved.set(g.slug, { projectId, sectionId });
  }

  console.log("\nGroups");
  const existing = await db.select().from(groups).where(eq(groups.userId, user.id));
  let sortOrder = existing.reduce((m, g) => Math.max(m, g.sortOrder), -1) + 1;
  for (const g of DEFAULT_GROUPS) {
    const loc = resolved.get(g.slug)!;
    const current = existing.find((e) => e.slug === g.slug);
    if (!current) {
      await db.insert(groups).values({
        userId: user.id,
        slug: g.slug,
        name: g.name,
        kind: g.kind,
        color: g.color,
        icon: g.icon,
        todoistProjectId: loc.projectId,
        todoistSectionId: loc.sectionId,
        calendarMatch: g.calendarMatch,
        sortOrder: sortOrder++,
      });
      log(`+ group ${g.name}`);
    } else if (!current.todoistProjectId) {
      await db.update(groups).set({ todoistProjectId: loc.projectId, todoistSectionId: loc.sectionId }).where(eq(groups.id, current.id));
      log(`~ mapped existing group ${current.name} to Todoist`);
    } else {
      log(`✓ group ${current.name} exists (left as configured)`);
    }
  }

  console.log("\nWeekly targets & stories");
  const defaults = await db
    .select({ metric: weeklyTargets.metric })
    .from(weeklyTargets)
    .where(and(eq(weeklyTargets.userId, user.id), isNull(weeklyTargets.weekStart)));
  for (const m of METRICS) {
    if (defaults.some((d) => d.metric === m.key)) continue;
    await db.insert(weeklyTargets).values({ userId: user.id, weekStart: null, metric: m.key, min: m.defaultMin, max: m.defaultMax }).onConflictDoNothing();
    log(`+ target ${m.label}`);
  }
  for (const [kind, bodyMd] of Object.entries(STORY_TEMPLATES)) {
    const inserted = await db
      .insert(stories)
      .values({ userId: user.id, kind: kind as keyof typeof STORY_TEMPLATES, bodyMd })
      .onConflictDoNothing()
      .returning({ id: stories.id });
    if (inserted.length) log(`+ story template ${kind}`);
  }

  console.log("\nDone. Sign in with Google as", email, "\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nSeed failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
