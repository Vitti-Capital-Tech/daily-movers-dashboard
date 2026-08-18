"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { signIn, type LoginState } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth-config";

export function LoginForm({
  error,
  next,
}: {
  error: string | null;
  next: string | null;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(
    signIn,
    null,
  );

  // The session cookie is set by the action, so navigate once it succeeds.
  // refresh() first so the new cookie is picked up by the server components.
  useEffect(() => {
    if (state?.ok && state.redirectTo) {
      router.refresh();
      router.replace(state.redirectTo);
    }
  }, [state, router]);

  return (
    <Card>
      <CardContent className="py-6">
        <form action={formAction} className="space-y-4">
          {next ? <input type="hidden" name="next" value={next} /> : null}

          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs text-muted-foreground">
              Work email
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              placeholder={`you@${ALLOWED_EMAIL_DOMAIN}`}
            />
          </div>

          {state && !state.ok ? (
            <p className="text-xs text-destructive">{state.message}</p>
          ) : error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : null}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? "Signing in…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
