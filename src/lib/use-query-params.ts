"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * Filters live in the URL so a filtered view is shareable and the back button
 * works. The server component re-runs the query on every change.
 */
export function useQueryParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParams = useCallback(
    (
      updates: Record<string, string | null>,
      options?: { keepPage?: boolean },
    ) => {
      const next = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }

      // Changing a filter should return to page 1 — otherwise you can land on
      // page 4 of a 1-page result set and see nothing.
      if (!options?.keepPage) next.delete("page");

      const query = next.toString();
      startTransition(() => {
        router.push(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      });
    },
    [pathname, router, searchParams],
  );

  return { searchParams, setParams, pending };
}
