"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Moon, Sun, Monitor, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const emptySubscribe = () => () => {};

export function ThemeToggle({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size={compact ? "icon" : "default"}
        className={cn(
          "relative rounded-lg border border-border/60 bg-background/50 text-muted-foreground transition-all",
          compact
            ? "size-8 p-0"
            : "h-8 w-full justify-start gap-2 px-2.5 text-xs",
          className,
        )}
        aria-label="Toggle theme"
      >
        <span className="size-3.5" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? "icon" : "default"}
            className={cn(
              "relative rounded-lg border border-border/60 bg-background/50 hover:bg-accent/80 hover:text-accent-foreground transition-all",
              compact
                ? "size-8 p-0"
                : "h-8 w-full justify-start gap-2 px-2.5 text-xs text-muted-foreground",
              className,
            )}
            aria-label="Select theme"
          />
        }
      >
        <div className="flex items-center gap-2">
          {theme === "dark" ? (
            <Moon className="size-3.5 text-indigo-400" />
          ) : theme === "light" ? (
            <Sun className="size-3.5 text-amber-500" />
          ) : (
            <Monitor className="size-3.5 text-muted-foreground" />
          )}
          {!compact && (
            <span className="capitalize font-medium text-foreground">
              {theme ?? "Theme"} Mode
            </span>
          )}
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-36 text-xs">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => setTheme("light")}
            className="flex items-center justify-between cursor-pointer py-1.5"
          >
            <div className="flex items-center gap-2">
              <Sun className="size-3.5 text-amber-500" />
              <span>Light</span>
            </div>
            {theme === "light" && <Check className="size-3 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setTheme("dark")}
            className="flex items-center justify-between cursor-pointer py-1.5"
          >
            <div className="flex items-center gap-2">
              <Moon className="size-3.5 text-indigo-400" />
              <span>Dark</span>
            </div>
            {theme === "dark" && <Check className="size-3 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setTheme("system")}
            className="flex items-center justify-between cursor-pointer py-1.5"
          >
            <div className="flex items-center gap-2">
              <Monitor className="size-3.5 text-muted-foreground" />
              <span>System</span>
            </div>
            {theme === "system" && <Check className="size-3 text-primary" />}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
