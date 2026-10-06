import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ---------------------------------------------------------------- Auth.js */

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: tz("email_verified"),
  image: text("image"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    /** AES-256-GCM encrypted (see lib/crypto.ts). */
    refresh_token: text("refresh_token"),
    /** AES-256-GCM encrypted (see lib/crypto.ts). */
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: tz("expires").notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: tz("expires").notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* ----------------------------------------------------------------- Enums */

export const groupKind = pgEnum("group_kind", [
  "pipeline",
  "people",
  "prep",
  "research",
  "options",
  "focus",
  "plain",
]);

export const applicationStage = pgEnum("application_stage", [
  "researching",
  "applied",
  "screen",
  "interview",
  "offer",
  "closed",
]);

export const contactRelationship = pgEnum("contact_relationship", [
  "friend",
  "ex_colleague",
  "recruiter",
  "cold",
]);

export const companyStatus = pgEnum("company_status", [
  "researching",
  "ready_to_apply",
  "ready_to_reach_out",
  "done",
]);

export const companyTier = pgEnum("company_tier", ["tier_1", "tier_2", "tier_3"]);

export const storyKind = pgEnum("story_kind", ["30s", "interview", "networking", "followups"]);

export const incomeType = pgEnum("income_type", ["online_work", "part_time", "freelance", "other"]);

export const incomeStatus = pgEnum("income_status", ["exploring", "trying", "keep", "drop"]);

export const focusStatus = pgEnum("focus_status", ["active", "paused", "done", "dropped"]);

export const activityType = pgEnum("activity_type", [
  "application",
  "outreach",
  "follow_up",
  "conversation",
  "prep_session",
  "side_income_hours",
  "task_completed",
]);

export const activitySource = pgEnum("activity_source", ["ui", "assistant"]);

export const pendingActionStatus = pgEnum("pending_action_status", [
  "awaiting_confirmation",
  "executing",
  "executed",
  "failed",
  "cancelled",
  "expired",
]);

/* ---------------------------------------------------------------- Groups */

export type CalendarMatchRule = {
  type: "equals" | "startsWith" | "contains";
  value: string;
};

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: groupKind("kind").notNull().default("plain"),
    color: text("color").notNull().default("#7986CB"),
    icon: text("icon").notNull().default("list-todo"),
    todoistProjectId: text("todoist_project_id"),
    todoistSectionId: text("todoist_section_id"),
    calendarMatch: jsonb("calendar_match").$type<CalendarMatchRule[]>().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: tz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("groups_user_slug_unique").on(t.userId, t.slug)],
);

/* ---------------------------------------------------------- Context data */

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domain: text("domain"),
    description: text("description"),
    why: text("why"),
    rolesOfInterest: text("roles_of_interest"),
    status: companyStatus("status").notNull().default("researching"),
    /** How attractive the company is to the user; null = not rated yet. */
    tier: companyTier("tier"),
    notes: text("notes"),
    todoistTaskId: text("todoist_task_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("companies_user_idx").on(t.userId)],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    companyName: text("company_name").notNull(),
    role: text("role").notNull(),
    url: text("url"),
    stage: applicationStage("stage").notNull().default("researching"),
    appliedAt: tz("applied_at"),
    nextFollowUpAt: tz("next_follow_up_at"),
    notes: text("notes"),
    todoistTaskId: text("todoist_task_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("applications_user_idx").on(t.userId)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    company: text("company"),
    relationship: contactRelationship("relationship").notNull().default("cold"),
    channel: text("channel"),
    lastContactAt: tz("last_contact_at"),
    nextCheckInAt: tz("next_check_in_at"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_user_idx").on(t.userId)],
);

export const interviews = pgTable("interviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
  scheduledAt: tz("scheduled_at").notNull(),
  stage: text("stage"),
  interviewer: text("interviewer"),
  prepNotes: text("prep_notes"),
  createdAt: createdAt(),
});

export const prepQuestions = pgTable("prep_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  category: text("category"),
  practicedAt: tz("practiced_at"),
  createdAt: createdAt(),
});

export const stories = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: storyKind("kind").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    updatedAt: updatedAt(),
  },
  (t) => [unique("stories_user_kind_unique").on(t.userId, t.kind)],
);

export const incomeOptions = pgTable("income_options", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: incomeType("type").notNull().default("other"),
  expectedHourly: numeric("expected_hourly", { mode: "number" }),
  hoursPerWeek: numeric("hours_per_week", { mode: "number" }),
  status: incomeStatus("status").notNull().default("exploring"),
  verdictNotes: text("verdict_notes"),
  createdAt: createdAt(),
});

/** At most 2 rows per user may be `active`; enforced in a transaction and by a DB trigger. */
export const focusItems = pgTable("focus_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  goal: text("goal"),
  status: focusStatus("status").notNull().default("paused"),
  link: text("link"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------ Activity & weeks */

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
    type: activityType("type").notNull(),
    value: numeric("value", { mode: "number" }).notNull().default(1),
    refType: text("ref_type"),
    refId: text("ref_id"),
    occurredAt: tz("occurred_at").notNull().defaultNow(),
    source: activitySource("source").notNull().default("ui"),
  },
  (t) => [index("activity_user_occurred_idx").on(t.userId, t.occurredAt)],
);

export const weeklyTargets = pgTable(
  "weekly_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** null = default target for every week. */
    weekStart: date("week_start", { mode: "string" }),
    metric: text("metric").notNull(),
    min: numeric("min", { mode: "number" }),
    max: numeric("max", { mode: "number" }),
  },
  (t) => [unique("weekly_targets_unique").on(t.userId, t.weekStart, t.metric).nullsNotDistinct()],
);

export const weeklyReviews = pgTable(
  "weekly_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    accomplished: text("accomplished"),
    productive: text("productive"),
    notProductive: text("not_productive"),
    demandRating: smallint("demand_rating"),
    routines: text("routines").$type<"yes" | "partly" | "no">(),
    changes: text("changes"),
    createdAt: createdAt(),
  },
  (t) => [unique("weekly_reviews_user_week_unique").on(t.userId, t.weekStart)],
);

/* ------------------------------------------------------------- Assistant */

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    summary: text("summary"),
    /** Number of leading messages folded into `summary`. */
    summarizedCount: integer("summarized_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("chat_sessions_user_idx").on(t.userId, t.updatedAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    /** AI SDK UIMessage JSON (id, role, parts, metadata). */
    message: jsonb("message").notNull(),
    seq: integer("seq").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_session_idx").on(t.sessionId, t.seq)],
);

export const pendingActions = pgTable(
  "pending_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatSessionId: text("chat_session_id").references(() => chatSessions.id, { onDelete: "set null" }),
    /** Request id of the chat turn that created it; write tools in one turn share one row. */
    turnId: text("turn_id"),
    toolName: text("tool_name").notNull(),
    input: jsonb("input").notNull(),
    preview: jsonb("preview").notNull(),
    status: pendingActionStatus("status").notNull().default("awaiting_confirmation"),
    result: jsonb("result"),
    error: text("error"),
    undone: boolean("undone").notNull().default(false),
    expiresAt: tz("expires_at").notNull(),
    createdAt: createdAt(),
    executedAt: tz("executed_at"),
  },
  (t) => [index("pending_actions_user_idx").on(t.userId, t.createdAt)],
);

export type Group = typeof groups.$inferSelect;
export type GroupKind = (typeof groupKind.enumValues)[number];
export type Application = typeof applications.$inferSelect;
export type ApplicationStage = (typeof applicationStage.enumValues)[number];
export type Contact = typeof contacts.$inferSelect;
export type ContactRelationship = (typeof contactRelationship.enumValues)[number];
export type Company = typeof companies.$inferSelect;
export type CompanyStatus = (typeof companyStatus.enumValues)[number];
export type CompanyTier = (typeof companyTier.enumValues)[number];
export type Interview = typeof interviews.$inferSelect;
export type PrepQuestion = typeof prepQuestions.$inferSelect;
export type Story = typeof stories.$inferSelect;
export type StoryKind = (typeof storyKind.enumValues)[number];
export type IncomeOption = typeof incomeOptions.$inferSelect;
export type IncomeType = (typeof incomeType.enumValues)[number];
export type IncomeStatus = (typeof incomeStatus.enumValues)[number];
export type FocusItem = typeof focusItems.$inferSelect;
export type FocusStatus = (typeof focusStatus.enumValues)[number];
export type Activity = typeof activityLog.$inferSelect;
export type ActivityType = (typeof activityType.enumValues)[number];
export type WeeklyTarget = typeof weeklyTargets.$inferSelect;
export type WeeklyReview = typeof weeklyReviews.$inferSelect;
export type ChatSession = typeof chatSessions.$inferSelect;
export type PendingAction = typeof pendingActions.$inferSelect;
export type PendingActionStatus = (typeof pendingActionStatus.enumValues)[number];
