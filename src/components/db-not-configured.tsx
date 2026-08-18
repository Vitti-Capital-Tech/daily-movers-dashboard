import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown when DATABASE_URL is set but the connection fails, so a wrong password
 * or unreachable host renders an explanation instead of a 500.
 */
export function DbUnreachable({ detail }: { detail?: string }) {
  return (
    <Card className="max-w-2xl border-destructive/40">
      <CardHeader>
        <CardTitle>Can&apos;t reach the database</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>
          The app is running and <code className="text-foreground">DATABASE_URL</code>{" "}
          is set, but the connection was refused.
        </p>
        {detail ? (
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">
            {detail}
          </pre>
        ) : null}
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-foreground">
              password authentication failed
            </span>{" "}
            — re-copy the database password from Supabase → Project Settings →
            Database (it is not the anon key, and not your account password).
          </li>
          <li>
            <span className="text-foreground">ENOTFOUND</span> — use the{" "}
            <span className="text-foreground">pooler</span> host
            (<code>…pooler.supabase.com:6543</code>), not{" "}
            <code>db.&lt;ref&gt;.supabase.co</code>, which is IPv6-only.
          </li>
        </ul>
        <p className="text-xs">
          Once it connects: <code className="text-foreground">npm run db:push</code>{" "}
          then <code className="text-foreground">npm run db:seed</code>.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Shown instead of a stack trace when DATABASE_URL is missing, so the app is
 * runnable before the database exists.
 */
export function DbNotConfigured() {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Database not connected yet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>
          The app is running, but <code className="text-foreground">DATABASE_URL</code>{" "}
          isn&apos;t set in <code className="text-foreground">.env.local</code>.
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            In Supabase: <span className="text-foreground">Project Settings → Database → Connection string → URI</span>
          </li>
          <li>
            Replace <code className="text-foreground">[YOUR-PASSWORD]</code> with your database password
          </li>
          <li>
            Paste it as <code className="text-foreground">DATABASE_URL</code> in{" "}
            <code className="text-foreground">.env.local</code> (project root)
          </li>
          <li>
            Run <code className="text-foreground">npm run db:push</code> then{" "}
            <code className="text-foreground">npm run db:seed</code>
          </li>
        </ol>
        <p className="text-xs">
          The Supabase URL and anon key are for auth and file storage later —
          they aren&apos;t a database connection string.
        </p>
      </CardContent>
    </Card>
  );
}
