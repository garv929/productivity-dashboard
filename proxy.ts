import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = [/^\/login(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/health$/];

/**
 * Optimistic gate only (Next.js 16 renamed middleware to proxy). Every Route Handler,
 * Server Action and page re-checks the session with `requireOwner()`.
 */
export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PATHS.some((re) => re.test(pathname))) return NextResponse.next();
  if (req.auth?.user) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL("/login", req.nextUrl.origin);
  if (pathname !== "/") url.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
