"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAssistant } from "@/components/chat/assistant-context";
import type { NavGroup } from "./app-shell";

export const QUICK_ADD_EVENT = "nsd:quick-add";
export const COMPLETE_NEXT_EVENT = "nsd:complete-next";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** ⌘K / Ctrl+K assistant, `n` quick add, `c` complete next step, `g` + number jump to group. */
export function KeyboardShortcuts({ groups }: { groups: NavGroup[] }) {
  const router = useRouter();
  const { setOpen, open } = useAssistant();
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || open) return;

      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          const n = Number(e.key);
          if (n === 0) router.push("/");
          else if (groups[n - 1]) router.push(`/g/${groups[n - 1].slug}`);
          return;
        }
        if (e.key === "h") return router.push("/");
        if (e.key === "s") return router.push("/scorecard");
      }

      if (e.key === "g") {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200);
      } else if (e.key === "n") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(QUICK_ADD_EVENT));
      } else if (e.key === "c") {
        window.dispatchEvent(new CustomEvent(COMPLETE_NEXT_EVENT));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groups, open, router, setOpen]);

  return null;
}
