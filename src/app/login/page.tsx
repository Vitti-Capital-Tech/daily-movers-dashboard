import { LoginForm } from "@/app/login/login-form";
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
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">
            Vitti Capital
          </h1>
          <p className="text-sm text-muted-foreground">
            Daily Movers Dashboard
          </p>
        </div>

        {/* Only a rough shape check here — the sign-in action runs the value
            through safeNextPath, which is authoritative. */}
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

        <p className="mt-6 text-xs text-muted-foreground">
          Access is limited to @{ALLOWED_EMAIL_DOMAIN} email addresses.
        </p>
      </div>
    </div>
  );
}
