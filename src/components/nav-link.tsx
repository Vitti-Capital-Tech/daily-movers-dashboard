"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function NavLink({
  href,
  children,
  icon,
  compact = false,
}: {
  href: string;
  children: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg text-sm font-medium transition-all duration-150",
        compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2",
        active
          ? "bg-primary text-primary-foreground shadow-xs"
          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
      )}
    >
      {icon && (
        <span
          className={cn(
            "shrink-0 transition-colors",
            active
              ? "text-primary-foreground"
              : "text-muted-foreground/80 group-hover:text-foreground",
          )}
        >
          {icon}
        </span>
      )}
      <span>{children}</span>
    </Link>
  );
}
