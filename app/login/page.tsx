import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { auth, signIn } from "@/auth";
import { isAllowedEmail } from "@/auth.config";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, { title: string; body: string }> = {
  private: {
    title: "This dashboard is private",
    body: "Access denied: this dashboard is private. Only the owner's Google account can sign in.",
  },
  AccessDenied: {
    title: "This dashboard is private",
    body: "Access denied: this dashboard is private. Only the owner's Google account can sign in.",
  },
  OAuthAccountNotLinked: {
    title: "Couldn't link that account",
    body: "Sign in with the same Google account you used before.",
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  const session = await auth();
  if (session?.user?.email && isAllowedEmail(session.user.email) && !error) redirect(callbackUrl || "/");

  const err = error ? (ERRORS[error] ?? { title: "Sign-in failed", body: "Something went wrong signing in. Please try again." }) : null;
  const safeCallback = callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/";

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden>
            <path d="M12 2.5l1.9 6.1 6.1 1.9-6.1 1.9L12 18.5l-1.9-6.1L4 10.5l6.1-1.9z" />
          </svg>
        </div>
        <h1 className="text-3xl">Next Steps</h1>
        <p className="mt-2 text-muted-foreground">Your job search, one clear next step at a time.</p>

        {err && (
          <div role="alert" className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-left text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <Lock className="size-4" /> {err.title}
            </div>
            <p className="mt-1 text-muted-foreground">{err.body}</p>
          </div>
        )}

        <form
          className="mt-8"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: safeCallback });
          }}
        >
          <Button type="submit" size="lg" className="h-11 w-full rounded-xl text-[15px]">
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
              <path fill="currentColor" d="M21.35 11.1H12v2.9h5.35c-.23 1.4-1.64 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.2 12 6.2c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.7 3.67 14.56 2.7 12 2.7 6.9 2.7 2.8 6.8 2.8 11.9S6.9 21.1 12 21.1c5.3 0 8.8-3.72 8.8-8.97 0-.6-.07-1.06-.15-1.53z" />
            </svg>
            Continue with Google
          </Button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">
          Requests read-only access to your Google Calendar.
        </p>
      </div>
    </main>
  );
}
