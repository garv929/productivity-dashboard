import { z } from "zod";

const base64Key32 = z
  .string()
  .min(1)
  .refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "must be 32 bytes, base64-encoded (openssl rand -base64 32)",
  });

const schema = z.object({
  AUTH_SECRET: z.string().min(1),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),
  ALLOWED_EMAIL: z.email().transform((v) => v.toLowerCase()),
  TOKEN_ENCRYPTION_KEY: base64Key32,
  DATABASE_URL: z.url(),
  TODOIST_API_TOKEN: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1),
  APP_TIMEZONE: z.string().min(1).default("America/Los_Angeles"),
  GOOGLE_CALENDAR_ID: z.string().min(1).default("primary"),
});

export type Env = z.infer<typeof schema>;

function shouldSkipValidation() {
  return (
    process.env.SKIP_ENV_VALIDATION === "1" ||
    process.env.NEXT_PHASE === "phase-production-build"
  );
}

function loadEnv(): Env {
  if (shouldSkipValidation()) {
    const partial = schema.partial().parse(process.env);
    return {
      ...partial,
      APP_TIMEZONE: partial.APP_TIMEZONE ?? "America/Los_Angeles",
      GOOGLE_CALENDAR_ID: partial.GOOGLE_CALENDAR_ID ?? "primary",
      ALLOWED_EMAIL: partial.ALLOWED_EMAIL ?? "",
    } as Env;
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid or missing environment variables:\n${issues}\nSee .env.example and README.md.`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
