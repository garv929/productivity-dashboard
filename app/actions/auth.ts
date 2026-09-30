"use server";

import { signIn, signOut } from "@/auth";

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

/** Re-runs Google consent to get a fresh refresh token (Calendar "Re-connect"). */
export async function reconnectGoogleAction() {
  await signIn("google", { redirectTo: "/settings" });
}
