import Link from "next/link";

export default function NotFound() {
  return (
    <main className="bg-grid flex min-h-screen items-center justify-center bg-bg-base px-4">
      <div className="rounded-2xl border border-border-subtle bg-bg-raised p-8 text-center">
        <p className="type-utility text-text-faint">404</p>
        <h1 className="mt-2 font-display text-xl font-semibold text-text-primary">
          Page not found
        </h1>
        <p className="mt-1 text-sm text-text-secondary">That page doesn&apos;t exist.</p>
        <Link
          href="/images"
          className="mt-5 inline-flex rounded-full bg-primary px-[22px] py-[10px] font-display text-sm font-medium text-text-primary shadow-glow hover:bg-primary-bright"
        >
          Back to the app
        </Link>
      </div>
    </main>
  );
}
