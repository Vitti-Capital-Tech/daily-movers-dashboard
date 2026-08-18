"use client";

import { useActionState } from "react";

import { sendMagicLink, type LoginState } from "@/app/login/actions";
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
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(
    sendMagicLink,
    null,
  );

  return (
    <Card>
      <CardContent className="py-6">
        {state?.ok ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Check your inbox</p>
            <p className="text-sm text-muted-foreground">{state.message}</p>
            <p className="text-xs text-muted-foreground">
              Didn&apos;t arrive? Check spam, then reload this page to send
              another.
            </p>
          </div>
        ) : (
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
              {isPending ? "Sending…" : "Email me a sign-in link"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
