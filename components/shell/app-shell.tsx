"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SWRConfig } from "swr";
import { ChevronsUpDown, Home, LogOut, Menu, Settings, Sparkles, Trophy } from "lucide-react";
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
import { ThemeSegmented } from "@/components/theme-toggle";
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
        <div className="flex min-h-dvh">
          <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r bg-surface lg:flex">
            <SidebarContent email={email} groups={groups} />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileBar email={email} groups={groups} />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 sm:px-6 lg:pt-8">{children}</main>
          </div>
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
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/" onClick={onClick} className="flex items-center gap-2.5 font-serif text-base leading-tight tracking-tight">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
          <path d="M12 2.5l1.9 6.1 6.1 1.9-6.1 1.9L12 18.5l-1.9-6.1L4 10.5l6.1-1.9z" />
        </svg>
      </span>
      Your Personal Productive Workspace
    </Link>
  );
}

/** Sidebar body, shared by the desktop column and the mobile sheet. */
function SidebarContent({ email, groups, onNavigate }: { email: string; groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full w-full flex-col">
      <div className={cn("px-4 pt-5 pb-4", onNavigate && "pr-12")}>
        <Brand onClick={onNavigate} />
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4" aria-label="Main">
        <div className="space-y-0.5">
          <NavLink href="/" active={pathname === "/"} onClick={onNavigate}>
            <Home className="size-4" /> Home
          </NavLink>
          <NavLink href="/scorecard" active={pathname === "/scorecard"} onClick={onNavigate}>
            <Trophy className="size-4" /> Scorecard
          </NavLink>
        </div>
        <div>
          <p className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">Groups</p>
          <div className="space-y-0.5">
            {groups.map((g, i) => (
              <NavLink key={g.slug} href={`/g/${g.slug}`} active={pathname === `/g/${g.slug}`} onClick={onNavigate}>
                <span className="flex size-4 items-center justify-center">
                  <GroupDot color={g.color} />
                </span>
                <span className="min-w-0 flex-1 truncate" title={i < 9 ? `${g.name} (g ${i + 1})` : g.name}>
                  {g.name}
                </span>
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      <div className="space-y-2 border-t p-3">
        <NavLink href="/settings" active={pathname === "/settings"} onClick={onNavigate}>
          <Settings className="size-4" /> Settings
        </NavLink>
        <ThemeSegmented compact className="w-full" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium uppercase">
                {email.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{email}</span>
              <ChevronsUpDown className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOutAction()}>
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Below lg: slim top bar whose menu button opens the sidebar as a sheet. */
function MobileBar({ email, groups }: { email: string; groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open menu">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 bg-surface p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <SidebarContent email={email} groups={groups} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <Brand />
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
