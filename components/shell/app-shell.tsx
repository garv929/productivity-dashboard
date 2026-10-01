"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SWRConfig } from "swr";
import { LogOut, Menu, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeSegmented, ThemeToggle } from "@/components/theme-toggle";
import { GroupDot } from "@/components/group-icon";
import { AssistantProvider, useAssistant } from "@/components/chat/assistant-context";
import { AssistantPanel } from "@/components/chat/assistant-panel";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { fetcher, FetchError } from "@/lib/client/fetcher";
import { signOutAction } from "@/app/actions/auth";
import { cn } from "@/lib/utils";

export type NavGroup = { slug: string; name: string; color: string; icon: string };

export function AppShell({ email, groups, children }: { email: string; groups: NavGroup[]; children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        refreshInterval: 60_000,
        revalidateOnFocus: true,
        keepPreviousData: true,
        onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
          if (error instanceof FetchError && [401, 403, 404].includes(error.status)) return;
          if (retryCount >= 5) return;
          const wait = error instanceof FetchError && error.retryAfter ? error.retryAfter * 1000 : 2 ** retryCount * 2000;
          setTimeout(() => revalidate({ retryCount }), wait);
        },
      }}
    >
      <AssistantProvider>
        <div className="flex min-h-dvh flex-col">
          <TopNav email={email} groups={groups} />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 sm:px-6">{children}</main>
        </div>
        <AssistantLauncher />
        <AssistantPanel groups={groups} />
        <KeyboardShortcuts groups={groups} />
      </AssistantProvider>
    </SWRConfig>
  );
}

function NavLink({ href, active, children, onClick }: { href: string; active: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function TopNav({ email, groups }: { email: string; groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const links = (onClick?: () => void) => (
    <>
      <NavLink href="/" active={pathname === "/"} onClick={onClick}>
        Home
      </NavLink>
      {groups.map((g, i) => (
        <NavLink key={g.slug} href={`/g/${g.slug}`} active={pathname === `/g/${g.slug}`} onClick={onClick}>
          <GroupDot color={g.color} />
          {g.name}
          <kbd className="ml-auto hidden text-[10px] text-muted-foreground/70 max-lg:inline">g {i + 1}</kbd>
        </NavLink>
      ))}
      <NavLink href="/scorecard" active={pathname === "/scorecard"} onClick={onClick}>
        Scorecard
      </NavLink>
      <NavLink href="/settings" active={pathname === "/settings"} onClick={onClick}>
        Settings
      </NavLink>
    </>
  );

  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 bg-background p-0">
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="font-serif text-lg">Your Personal Productive Workspace</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-0.5 p-3">{links(() => setOpen(false))}</nav>
            <div className="mt-auto border-t p-4">
              <p className="mb-2 text-xs text-muted-foreground">Appearance</p>
              <ThemeSegmented />
            </div>
          </SheetContent>
        </Sheet>

        <Link href="/" className="flex items-center gap-2 font-serif text-lg tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
              <path d="M12 2.5l1.9 6.1 6.1 1.9-6.1 1.9L12 18.5l-1.9-6.1L4 10.5l6.1-1.9z" />
            </svg>
          </span>
          <span className="max-sm:hidden">Your Personal Productive Workspace</span>
        </Link>

        <nav className="ml-2 hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">{links()}</nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Account">
                <span className="flex size-7 items-center justify-center rounded-full bg-secondary text-xs font-medium uppercase">
                  {email.slice(0, 1)}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="font-normal text-muted-foreground">{email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void signOutAction()}>
                <LogOut className="size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

function AssistantLauncher() {
  const { open, setOpen } = useAssistant();
  if (open) return null;
  return (
    <button
      onClick={() => setOpen(true)}
      className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:scale-[1.03] active:scale-100"
      aria-label="Open assistant (⌘K)"
    >
      <Sparkles className="size-4" />
      <span className="max-sm:hidden">Ask assistant</span>
      <kbd className="rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] max-sm:hidden">⌘K</kbd>
    </button>
  );
}
