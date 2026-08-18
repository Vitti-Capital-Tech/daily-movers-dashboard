"use client";

import { LogOut, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SessionUser } from "@/lib/auth";

function initials(email: string): string {
  const [local] = email.split("@");
  const parts = local.split(/[._-]/).filter(Boolean);
  const letters =
    parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : local.slice(0, 2);
  return letters.toUpperCase();
}

export function UserMenu({
  user,
  compact = false,
}: {
  user: SessionUser;
  compact?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className={
              compact
                ? "size-8 rounded-full p-0 text-xs border border-border/60"
                : "h-auto w-full justify-start gap-2.5 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2 hover:bg-accent/80 transition-colors"
            }
            aria-label="Account menu"
          />
        }
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold">
          {initials(user.email)}
        </span>
        {!compact ? (
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-xs font-medium text-foreground">
              {user.email}
            </span>
            <span className="block text-[10px] text-muted-foreground">
              {user.role === "admin" ? "Author / Analyst" : "Research Consumer"}
            </span>
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60 text-xs">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal p-2.5">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                <UserIcon className="size-3" />
              </div>
              <span className="font-semibold text-foreground truncate">
                {user.email}
              </span>
            </div>
            <span className="block text-[11px] text-muted-foreground">
              {user.role === "admin"
                ? "Admin — Full write & delete permissions"
                : "Viewer — Read-only research access"}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <form action="/auth/signout" method="post">
          <DropdownMenuItem
            nativeButton
            className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
            render={
              <button type="submit" className="w-full cursor-pointer flex items-center gap-2 text-left" />
            }
          >
            <LogOut className="size-3.5" />
            <span>Sign out</span>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
