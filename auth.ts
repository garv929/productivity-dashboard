import NextAuth from "next-auth";
import type { Adapter, AdapterAccount } from "next-auth/adapters";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import { authConfig } from "./auth.config";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { encryptNullable } from "@/lib/crypto";

function encryptTokens<T extends Partial<AdapterAccount>>(account: T): T {
  return {
    ...account,
    refresh_token: encryptNullable(account.refresh_token as string | undefined),
    access_token: encryptNullable(account.access_token as string | undefined),
  };
}

function adapter(): Adapter {
  const base = DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  });
  return {
    ...base,
    linkAccount: (account) => base.linkAccount!(encryptTokens(account)),
  };
}

/**
 * Auth.js only calls `linkAccount` on the first sign-in, so tokens issued on later
 * sign-ins (prompt=consent returns a fresh refresh token) are persisted here.
 */
async function storeGoogleTokens(account: AdapterAccount | Record<string, unknown>) {
  const a = account as Partial<AdapterAccount>;
  if (a.provider !== "google" || !a.providerAccountId) return;
  const patch: Partial<typeof accounts.$inferInsert> = {
    access_token: encryptNullable(a.access_token),
    expires_at: a.expires_at ?? null,
    scope: a.scope ?? null,
    token_type: a.token_type ?? null,
    id_token: a.id_token ?? null,
  };
  if (a.refresh_token) patch.refresh_token = encryptNullable(a.refresh_token);
  await db
    .update(accounts)
    .set(patch)
    .where(and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, a.providerAccountId)));
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  ...authConfig,
  adapter: adapter(),
  events: {
    async signIn({ account }) {
      if (account) await storeGoogleTokens(account);
    },
  },
}));
