"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type AssistantState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Opens the panel and sends `text` as a message. */
  ask: (text: string) => void;
  pendingPrompt: string | null;
  consumePrompt: () => string | null;
};

const Ctx = createContext<AssistantState | null>(null);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const ask = useCallback((text: string) => {
    setPendingPrompt(text);
    setOpen(true);
  }, []);
  const consumePrompt = useCallback(() => {
    const p = pendingPrompt;
    setPendingPrompt(null);
    return p;
  }, [pendingPrompt]);
  const value = useMemo(() => ({ open, setOpen, ask, pendingPrompt, consumePrompt }), [open, ask, pendingPrompt, consumePrompt]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAssistant must be used inside AssistantProvider");
  return ctx;
}
