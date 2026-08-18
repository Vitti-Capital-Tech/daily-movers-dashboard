"use client";

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
                ? "size-8 rounded-full p-0 text-xs"
                : "h-auto w-full justify-start gap-2 px-2 py-2"
            }
            aria-label="Account menu"
          />
        }
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold">
          {initials(user.email)}
        </span>
        {!compact ? (
          <span className="min-w-0 text-left">
            <span className="block truncate text-xs">{user.email}</span>
            <span className="block text-[10px] text-muted-foreground">
              {user.role === "admin" ? "Can edit" : "View only"}
            </span>
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        {/* Base UI requires GroupLabel to sit inside a Group — using
            DropdownMenuLabel bare throws MenuGroupContext is missing. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-xs">{user.email}</span>
            <span className="block text-[10px] text-muted-foreground">
              {user.role === "admin"
                ? "Admin — can add, edit and delete"
                : "Viewer — read-only"}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* A form POST, not a link: signing out is a state change.
            Menu.Item defaults to nativeButton=false, so it must be told the
            rendered element really is a <button> — otherwise Base UI adds
            non-native a11y attributes on top of native ones. (Triggers already
            default to true, which is why only this one needed it.) */}
        <form action="/auth/signout" method="post">
          <DropdownMenuItem
            nativeButton
            render={
              <button type="submit" className="w-full cursor-default text-left" />
            }
          >
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
