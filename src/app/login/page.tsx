import { LoginForm } from "@/components/auth/LoginForm";

export const metadata = { title: "Sign in · Content Studio" };

export default function LoginPage() {
  return (
    <main className="bg-grid flex min-h-screen items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-bg-raised p-6">
        <span className="type-utility inline-flex items-center gap-1.5 rounded-full border border-border-strong px-2.5 py-1 text-primary-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Internal platform
        </span>
        <h1 className="mt-4 font-display text-[28px] font-bold leading-tight text-text-primary">
          AI <span className="text-gradient-brand">Agency</span> Institute
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Marketing &amp; content operations
        </p>
        <div className="mt-6">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
