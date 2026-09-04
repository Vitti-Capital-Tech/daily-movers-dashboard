"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import { generatePostAction, type PostActionState } from "@/actions/posts";
import { Button } from "@/components/ui/button";

/**
 * Assess the same mover again, later.
 *
 * The reason this exists is that a verdict is a judgement about a moment, not
 * about the note. "Too early to say" three weeks after publication is the right
 * answer then and the wrong one three months later — and a `mixed` verdict often
 * turns on milestones the note named that simply hadn't happened yet. Without a
 * way back in, those movers would be permanently written off by their first
 * assessment.
 *
 * It also closes a gap the drift warning had opened: that warning tells the
 * reviewer to re-assess before posting stale figures, and until now there was
 * nothing to click.
 *
 * Re-running is a *new row*, never an overwrite — see the note on
 * `listAssessmentsForMover`. The history is what distinguishes re-examining a
 * call from shopping it until the verdict comes out favourably.
 */
export function ReassessButton({
  moverId,
  label = "Assess again",
  variant = "outline",
  size = "sm",
}: {
  moverId: number;
  label?: string;
  variant?: "outline" | "ghost";
  size?: "sm" | "default";
}) {
  const [busy, setBusy] = useState(false);

  const [, formAction] = useActionState<PostActionState, FormData>(
    async (prev, formData) => {
      const result = await generatePostAction(prev, formData);
      // A success redirects to the new assessment's page, so only failures
      // return here with anything to say.
      setBusy(false);
      if (result?.message) toast.error(result.message);
      return result;
    },
    null,
  );

  return (
    <form action={formAction} onSubmit={() => setBusy(true)}>
      <input type="hidden" name="moverId" value={moverId} />
      <Button
        type="submit"
        variant={variant}
        size={size}
        className="gap-1.5"
        disabled={busy}
        title="Run the assessment again against today's price"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        {busy ? "Assessing…" : label}
      </Button>
    </form>
  );
}
