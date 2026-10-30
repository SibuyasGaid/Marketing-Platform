import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";
import { isDemoMode } from "@/lib/demoMode";

export const metadata = { title: "Sign in · Content Studio" };

// Must be evaluated per request, not at build time: `next build` deliberately
// runs without secrets (lib/config.ts), so a prerendered page would bake in
// whatever isDemoMode() returned on the build machine and could strand a
// properly configured deployment on the demo screen.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  // Demo mode has no auth provider, and proxy.ts already redirects /login to the
  // app. This branch only renders if someone reaches the page directly.
  const demo = isDemoMode();

  return (
    <main className="bg-grid flex min-h-screen items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-bg-raised p-6">
        <span className="type-utility inline-flex items-center gap-1.5 rounded-full border border-border-strong px-2.5 py-1 text-primary-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {demo ? "Demo build" : "Internal platform"}
        </span>
        <h1 className="mt-4 font-display text-[28px] font-bold leading-tight text-text-primary">
          Content <span className="text-gradient-brand">Studio</span>
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          AI content generation &amp; social publishing
        </p>
        {demo ? (
          <div className="mt-6 flex flex-col gap-3">
            <p className="text-sm text-text-secondary">
              This build has no database connected, so there is nothing to sign in to. Browse the
              full interface with sample data instead.
            </p>
            <Link
              href="/"
              className="rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-semibold text-on-primary transition-colors hover:bg-primary-bright"
            >
              Enter the demo
            </Link>
          </div>
        ) : (
          <div className="mt-6">
            <LoginForm />
          </div>
        )}
      </div>
    </main>
  );
}
