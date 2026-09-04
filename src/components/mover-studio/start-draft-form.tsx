"use client";

import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import { startDraftAction, type DraftActionState } from "@/actions/drafts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_SCREEN_VALUES, SCREEN_FIELDS } from "./screen-fields";

/**
 * Starts a draft off-schedule, with the liquidity screen exposed as controls.
 *
 * There is deliberately no date picker. The board is computed from live quotes,
 * so there is no way to ask it for a past session — the pipeline reads the
 * session date off the feed's own timestamps instead. Offering a date field
 * would promise something the screen cannot deliver.
 *
 * The screen is adjustable rather than fixed because the defaults are
 * deliberately conservative — they exist to keep nano-caps that traded a few
 * thousand dollars off the shortlist — and an analyst who wants a genuinely
 * interesting micro-cap covered should be able to widen them for one run
 * instead of asking for a code change. Collapsed by default, since the default
 * screen is the right answer nearly every day.
 */
export function StartDraftForm({ today }: { today: string }) {
  const [state, formAction, isPending] = useActionState<
    DraftActionState,
    FormData
  >(async (prev, formData) => {
    const result = await startDraftAction(prev, formData);
    if (result?.ok) toast.success(result.message ?? "Drafting started.");
    else if (result?.message) toast.error(result.message);
    return result;
  }, null);

  const [showScreen, setShowScreen] = useState(false);

  return (
    <Card>
      <CardContent className="py-4">
        <form action={formAction} className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {isPending ? "Starting…" : "Draft a Daily Mover now"}
            </Button>

            <p className="text-xs text-muted-foreground">
              Drafts the latest ASX session
              {today ? <span className="ml-1 font-mono">({today})</span> : null}
            </p>

            <button
              type="button"
              onClick={() => setShowScreen((open) => !open)}
              className="ml-auto flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Screen settings
              <ChevronDown
                className={`size-3.5 transition-transform ${showScreen ? "rotate-180" : ""}`}
              />
            </button>
          </div>

          {/* Always in the DOM, so a collapsed panel still submits its values
              rather than falling back to the defaults on the server. */}
          <div
            className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ${showScreen ? "" : "hidden"}`}
          >
            {SCREEN_FIELDS.map((field) => (
              <div key={field.name} className="space-y-1">
                <Label
                  htmlFor={field.name}
                  className="text-[11px] text-muted-foreground"
                >
                  {field.label}
                </Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  defaultValue={DEFAULT_SCREEN_VALUES[field.name]}
                  className="h-8 font-mono text-xs"
                />
                <p className="text-[10px] leading-snug text-muted-foreground/80">
                  {field.hint}
                </p>
              </div>
            ))}
          </div>

          {state?.ok === false && state.message ? (
            <p className="text-xs text-destructive">{state.message}</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
