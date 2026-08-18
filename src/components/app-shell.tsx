import Link from "next/link";
import type { ReactNode } from "react";
import { TrendingUp, Building2, Activity, ShieldCheck, Eye } from "lucide-react";

import { NavLink } from "@/components/nav-link";
import { UserMenu } from "@/components/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import type { SessionUser } from "@/lib/auth";

export function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user: SessionUser;
}) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border/70 bg-sidebar/50 backdrop-blur-xs md:flex">
        {/* Brand Header */}
        <div className="px-5 py-6 border-b border-border/50">
          <Link href="/daily-movers" className="flex items-center gap-3 group">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs group-hover:scale-105 transition-transform">
              <Activity className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
                Vitti Capital
                <span className="inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <div className="text-[11px] font-medium text-muted-foreground">
                Daily Movers Terminal
              </div>
            </div>
          </Link>
        </div>

        {/* Navigation Section */}
        <div className="px-3 py-4">
          <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Equity Research
          </div>
          <nav className="flex flex-col gap-1">
            <NavLink
              href="/daily-movers"
              icon={<TrendingUp className="size-4" />}
            >
              Daily Movers
            </NavLink>
            <NavLink
              href="/companies"
              icon={<Building2 className="size-4" />}
            >
              Companies
            </NavLink>
          </nav>
        </div>

        {/* Bottom Chrome & User Controls */}
        <div className="mt-auto space-y-3 border-t border-border/50 p-4 bg-sidebar/30">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {user.canWrite ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px] font-medium px-2 py-0.5"
                >
                  <ShieldCheck className="size-3 mr-1" />
                  Admin
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-muted text-muted-foreground border-border text-[10px] font-medium px-2 py-0.5"
                >
                  <Eye className="size-3 mr-1" />
                  Read-only
                </Badge>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="min-w-0 flex-1 flex flex-col">
        {/* Mobile Header */}
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 backdrop-blur-md px-4 py-3 md:hidden">
          <Link href="/daily-movers" className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity className="size-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Vitti Capital</span>
          </Link>

          <nav className="flex items-center gap-1">
            <NavLink href="/daily-movers" compact>
              Movers
            </NavLink>
            <NavLink href="/companies" compact>
              Companies
            </NavLink>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            <UserMenu user={user} compact />
          </div>
        </div>

        {/* Content Body */}
        <div className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
