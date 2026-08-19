"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Lock, KeyRound, Eye, EyeOff, ShieldCheck } from "lucide-react";

import { unlockAdmin } from "@/actions/admin-auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdminUnlockDialog({
  trigger,
}: {
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const res = await unlockAdmin(null, formData);
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
      } else {
        setErrorMessage(res.message ?? "Incorrect passcode");
        toast.error(res.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ? (
            trigger as React.ReactElement
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs font-semibold border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 cursor-pointer"
            >
              <KeyRound className="size-3.5" />
              <span>Admin Unlock</span>
            </Button>
          )
        }
      />

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Lock className="size-4" />
            </span>
            <DialogTitle>Unlock Editor Mode</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Enter the admin passcode to enable adding, AI extraction, editing, and deleting Daily Movers.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-2">
            <Label htmlFor="passcode" className="text-xs font-medium">
              Admin Passcode
            </Label>
            <div className="relative">
              <Input
                id="passcode"
                name="passcode"
                type={showPassword ? "text" : "password"}
                placeholder="Enter secret passcode"
                required
                autoFocus
                className="pr-9 text-xs"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                aria-label={showPassword ? "Hide passcode" : "Show passcode"}
              >
                {showPassword ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </button>
            </div>
            {errorMessage && (
              <p className="text-xs text-destructive font-medium">{errorMessage}</p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isPending}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="text-xs font-semibold gap-1.5"
            >
              {isPending ? (
                "Verifying..."
              ) : (
                <>
                  <ShieldCheck className="size-3.5" />
                  <span>Unlock Admin</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
