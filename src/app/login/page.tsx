import { Activity } from "lucide-react";
import { LoginForm } from "@/app/login/login-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth-config";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  domain: `That address isn't an @${ALLOWED_EMAIL_DOMAIN} account, so you were signed out.`,
  expired: "Your session expired. Enter your email again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const pick = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const errorKey = pick("error");
  const error = errorKey ? (ERRORS[errorKey] ?? ERRORS.expired) : null;
  const next = pick("next");

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      {/* Top right theme toggle */}
      <div className="absolute right-4 top-4">
        <ThemeToggle compact />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
            <Activity className="size-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Vitti Capital
          </h1>
          <p className="text-xs font-medium text-muted-foreground mt-0.5">
            Daily Movers Research Terminal
          </p>
        </div>

        <LoginForm
          error={error}
          next={
            typeof next === "string" &&
            next.startsWith("/") &&
            !next.startsWith("//") &&
            !next.includes("\\")
              ? next
              : null
          }
        />

        <div className="mt-6 text-center text-xs text-muted-foreground">
          <p>Restricted access for <span className="font-semibold text-foreground">@{ALLOWED_EMAIL_DOMAIN}</span> members.</p>
        </div>
      </div>
    </div>
  );
}
