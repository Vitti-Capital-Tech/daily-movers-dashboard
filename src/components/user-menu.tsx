"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Lock, LogOut, KeyRound, ShieldCheck, Eye } from "lucide-react";
import { lockAdmin } from "@/actions/admin-auth";
import { AdminUnlockDialog } from "@/components/admin-unlock-dialog";
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

export function UserMenu({
  user,
  compact = false,
}: {
  user: SessionUser;
  compact?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleLockAdmin() {
    startTransition(async () => {
      const res = await lockAdmin();
      if (res.ok) {
        toast.success(res.message);
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5 w-full">
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
          <span
            className={
              user.canWrite
                ? "flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 text-[10px] font-bold"
                : "flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold"
            }
          >
            {user.canWrite ? (
              <ShieldCheck className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </span>
          {!compact ? (
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-xs font-semibold text-foreground">
                {user.canWrite ? "Admin Mode" : "Viewer Mode"}
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {user.canWrite ? "Full edit & add access" : "Read-only access"}
              </span>
            </span>
          ) : null}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-60 text-xs">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <div
                  className={
                    user.canWrite
                      ? "flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold"
                      : "flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary font-bold"
                  }
                >
                  {user.canWrite ? (
                    <ShieldCheck className="size-3" />
                  ) : (
                    <Eye className="size-3" />
                  )}
                </div>
                <span className="font-semibold text-foreground truncate">
                  {user.canWrite ? "Editor Active" : "Public Viewer"}
                </span>
              </div>
              <span className="block text-[11px] text-muted-foreground">
                {user.canWrite
                  ? "You have full write and delete permissions."
                  : "Browsing in read-only mode."}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />

          {user.canWrite ? (
            <DropdownMenuItem
              nativeButton
              onClick={handleLockAdmin}
              disabled={isPending}
              className="text-muted-foreground focus:text-foreground cursor-pointer"
            >
              <Lock className="size-3.5 mr-2" />
              <span>{isPending ? "Locking..." : "Exit Admin Mode"}</span>
            </DropdownMenuItem>
          ) : (
            <AdminUnlockDialog
              trigger={
                <DropdownMenuItem
                  nativeButton
                  className="text-amber-600 dark:text-amber-400 focus:text-amber-500 cursor-pointer"
                >
                  <KeyRound className="size-3.5 mr-2" />
                  <span>Unlock Admin Mode</span>
                </DropdownMenuItem>
              }
            />
          )}

          {user.email !== "viewer@vitti.capital" && (
            <>
              <DropdownMenuSeparator />
              <form action="/auth/signout" method="post">
                <DropdownMenuItem
                  nativeButton
                  className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
                  render={
                    <button
                      type="submit"
                      className="w-full cursor-pointer flex items-center gap-2 text-left"
                    />
                  }
                >
                  <LogOut className="size-3.5" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </form>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
