"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Handled once per page load; client-side navigation between pages never re-triggers it. */
let checked = false;

/**
 * A browser refresh (⌘R / F5 / the reload button) on any page lands on Home. Only reloads
 * count: following a link, a bookmark or a typed URL opens that page as usual.
 */
export function ReloadToHome() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (checked) return;
    checked = true;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === "reload" && pathname !== "/") router.replace("/");
  }, [pathname, router]);

  return null;
}
