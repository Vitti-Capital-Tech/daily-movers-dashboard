"use client";

import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import { startDraftAction, type DraftActionState } from "@/actions/drafts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ScreenCriteria } from "@/lib/asx/types";

import { SCREEN_FIELDS } from "./screen-fields";

/**
 * Starts a draft off-schedule, with the liquidity screen exposed as controls.
 *
 * There is deliberately no date picker. The board is computed from live quotes,
 * so there is no way to ask it for a past session — the pipeline reads the
 * session date off the feed's own timestamps instead. Offering a date field
 * would promise something the screen cannot deliver.
 *
 * The screen is adjustable rather than fixed so an analyst who wants a
 * genuinely interesting micro-cap covered can widen it without asking for a
 * code change. Collapsed by default, since the screen in force is the right
 * answer nearly every day.
 *
 * `screen` is the *stored* screen, read on the server, not the compiled
 * `DEFAULT_SCREEN`. Submitting the form saves these values, so what is shown
 * here is also what the 06:00 scheduled run will use — a standing setting that
 * happens to live behind a button, not a per-run override.
 */
export function StartDraftForm({
  today,
  screen,
}: {
  today: string;
  screen: ScreenCriteria;
}) {
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
        {/**
         * `noValidate`, because the server is the one that decides.
         *
         * `readCriterion` clamps every field into `SCREEN_LIMITS` before the
         * screen runs, so browser validation adds nothing except a way for the
         * form to fail invisibly: an invalid control inside the collapsed panel
         * cannot be focused, so Chrome refuses to submit and shows the user
         * nothing. That is exactly what happened on 14 September 2026, when the
         * market-cap default sat off its own step.
         */}
        <form action={formAction} noValidate className="space-y-4">
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
          <div className={`space-y-3 ${showScreen ? "" : "hidden"}`}>
            <p className="text-[11px] text-muted-foreground">
              Saved when you start a draft. The scheduled 06:00 IST run uses
              these too — they are not just for this one draft.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  defaultValue={screen[field.name]}
                  className="h-8 font-mono text-xs"
                />
                <p className="text-[10px] leading-snug text-muted-foreground/80">
                  {field.hint}
                </p>
              </div>
            ))}
            </div>
          </div>

          {state?.ok === false && state.message ? (
            <p className="text-xs text-destructive">{state.message}</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
