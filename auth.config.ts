import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export const GOOGLE_SCOPES =
  "openid email profile https://www.googleapis.com/auth/calendar.readonly";

export function isAllowedEmail(email: string | null | undefined): boolean {
  const allowed = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  return Boolean(allowed && email && email.trim().toLowerCase() === allowed);
}

/** Adapter-free config shared by `proxy.ts` and `auth.ts`. */
export const authConfig = {
  providers: [
    Google({
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          access_type: "offline",
          // Always show Google's account chooser (otherwise Google silently uses the
          // browser's default account), pre-filled with the one account allowed in.
          prompt: "select_account consent",
          ...(process.env.ALLOWED_EMAIL && { login_hint: process.env.ALLOWED_EMAIL.trim() }),
          include_granted_scopes: "true",
        },
      },
      // Single allowlisted owner whose email Google has verified; lets `pnpm seed`
      // pre-create the user row by email before the first sign-in.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    signIn({ profile, user }) {
      const email = profile?.email ?? user?.email;
      if (!isAllowedEmail(email) || profile?.email_verified === false) {
        return "/login?error=private";
      }
      return true;
    },
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
