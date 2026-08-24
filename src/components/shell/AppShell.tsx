"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/app/login/actions";
import { formatUsd } from "@/components/usage/CostBadge";
import {
  ProviderAlertModal,
  type ProviderAlertView,
} from "@/components/usage/ProviderAlertModal";
import type { Role } from "@/lib/domain";

interface ShellProfile {
  email: string;
  displayName: string | null;
  role: Role;
}

const NAV_ITEMS = [
  {
    href: "/images",
    label: "Brand Images",
    icon: (
      <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-none stroke-current stroke-[1.5]">
        <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
        <circle cx="7" cy="8" r="1.5" />
        <path d="m3 14 4-4 3 3 4-4 3 3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/content",
    label: "Content Engine",
    icon: (
      <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-none stroke-current stroke-[1.5]">
        <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
        <path d="m8.5 8 3.5 2-3.5 2z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/avatar",
    label: "Generate Videos",
    icon: (
      <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-none stroke-current stroke-[1.5]">
        <circle cx="10" cy="7" r="3" />
        <path d="M4 16.5c0-3 2.7-5 6-5s6 2 6 5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/queue",
    label: "Approval Queue",
    icon: (
      <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-none stroke-current stroke-[1.5]">
        <rect x="3" y="4" width="14" height="13" rx="2" />
        <path d="M3 8h14M7 2.5v3M13 2.5v3" strokeLinecap="round" />
        <path d="m7.5 12.5 1.5 1.5 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/library",
    label: "Library",
    icon: (
      <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-none stroke-current stroke-[1.5]">
        <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
        <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" />
        <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" />
        <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/accounts",
    label: "Accounts",
    icon: (
      <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-none stroke-current stroke-[1.5]">
        <circle cx="7" cy="7.5" r="2.5" />
        <path d="M2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" strokeLinecap="round" />
        <path d="M13 6.5a2 2 0 0 1 0 4M14.5 15.5c0-1.6-.8-2.9-2-3.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/admin",
    label: "Admin",
    icon: (
      <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-none stroke-current stroke-[1.5]">
        <path d="M10 2.5 16.5 5v4.5c0 4-2.7 6.9-6.5 8-3.8-1.1-6.5-4-6.5-8V5z" strokeLinejoin="round" />
        <path d="m7.5 10 1.8 1.8 3.2-3.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
] as const;

const PAGE_TITLES: Record<string, string> = {
  "/images": "Brand Images",
  "/content": "Content Engine",
  "/avatar": "Generate Videos",
  "/queue": "Approval Queue",
  "/library": "Library",
  "/accounts": "Accounts",
  "/admin": "Admin",
};

function pageTitle(pathname: string): string {
  const match = Object.keys(PAGE_TITLES).find((prefix) => pathname.startsWith(prefix));
  return match ? PAGE_TITLES[match] : "Dashboard";
}

function initials(profile: ShellProfile): string {
  const source = profile.displayName ?? profile.email;
  return source.slice(0, 2).toUpperCase();
}

export function AppShell({
  profile,
  usageTodayUsd,
  alerts,
  activeCounts,
  demoMode = false,
  children,
}: {
  profile: ShellProfile;
  usageTodayUsd: number;
  alerts: ProviderAlertView[];
  /** In-flight generation counts per section, for the nav "working" cue. */
  activeCounts?: { images: number; videos: number };
  /** True when no database is configured; shows the read-only tour banner. */
  demoMode?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeFor = (href: string) =>
    href === "/images"
      ? (activeCounts?.images ?? 0)
      : href === "/avatar"
        ? (activeCounts?.videos ?? 0)
        : 0;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-1 px-3">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname.startsWith(item.href);
        const working = activeFor(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={working > 0 ? `${item.label} — ${working} generating` : item.label}
            onClick={() => setIsMobileNavOpen(false)}
            className={`flex items-center gap-3 rounded-full px-3.5 py-2.5 font-display text-sm font-medium transition-colors ${
              isActive
                ? "bg-primary text-text-primary"
                : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}
          >
            <span className="relative flex shrink-0">
              {item.icon}
              {working > 0 && isCollapsed ? (
                <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-primary-bright ring-2 ring-bg-nav" />
              ) : null}
            </span>
            {!isCollapsed ? (
              <>
                <span className="truncate">{item.label}</span>
                {working > 0 ? (
                  <span className="ml-auto inline-flex min-w-[1.25rem] animate-pulse items-center justify-center rounded-full bg-primary-bright/20 px-1.5 py-0.5 text-[11px] font-semibold text-primary-soft">
                    {working}
                  </span>
                ) : null}
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-bg-base text-text-secondary">
      {/* Desktop sidebar */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border-subtle bg-bg-nav py-5 transition-[width] md:flex ${
          isCollapsed ? "w-[68px]" : "w-[240px]"
        }`}
      >
        <div className={`mb-8 flex items-center px-5 ${isCollapsed ? "justify-center px-0" : ""}`}>
          <Link href="/" className="flex items-center gap-2">
            <span className="font-display text-lg font-bold text-text-primary">CS</span>
            {!isCollapsed ? (
              <span className="leading-tight">
                <span className="block font-display text-[11px] font-bold uppercase tracking-[0.12em] text-text-primary">
                  Content
                </span>
                <span className="type-utility block text-text-faint">Studio</span>
              </span>
            ) : null}
          </Link>
        </div>
        {nav}
        <button
          type="button"
          onClick={() => setIsCollapsed((collapsed) => !collapsed)}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mx-3 mt-auto flex items-center justify-center rounded-full py-2 text-text-faint hover:bg-bg-hover hover:text-text-primary"
        >
          <svg
            viewBox="0 0 20 20"
            className={`h-4 w-4 fill-none stroke-current stroke-2 transition-transform ${
              isCollapsed ? "rotate-180" : ""
            }`}
          >
            <path d="m12 4-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </aside>

      {/* Mobile slide-over nav */}
      {isMobileNavOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setIsMobileNavOpen(false)}
            className="absolute inset-0 bg-bg-nav/80"
          />
          <aside className="relative flex h-full w-[240px] flex-col border-r border-border-subtle bg-bg-nav py-5">
            <div className="mb-8 px-5 font-display text-sm font-bold uppercase tracking-[0.12em] text-text-primary">
              Content Studio
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border-subtle bg-bg-nav px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(true)}
              aria-label="Open navigation"
              className="rounded-full p-2 text-text-secondary hover:bg-bg-hover md:hidden"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5 fill-none stroke-current stroke-2">
                <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
              </svg>
            </button>
            <h1 className="truncate font-display text-lg font-semibold text-text-primary">
              {pageTitle(pathname)}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <ProviderAlertModal alerts={alerts} />
            <Link
              href="/admin"
              title="AI spend today. See Admin for the breakdown"
              className="type-utility hidden items-center gap-1.5 rounded-full border border-border-subtle px-2.5 py-1 text-text-secondary hover:border-border-strong hover:text-text-primary sm:inline-flex"
            >
              Today {formatUsd(usageTodayUsd)}
            </Link>
            <Link
              href="/images"
              className="hidden rounded-full bg-primary px-[22px] py-[10px] font-display text-sm font-medium text-text-primary shadow-glow transition-colors hover:bg-primary-bright hover:shadow-glow-hover sm:inline-flex"
            >
              Generate
            </Link>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsUserMenuOpen((open) => !open)}
                aria-label="User menu"
                aria-expanded={isUserMenuOpen}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle bg-bg-raised font-display text-xs font-semibold text-text-primary hover:border-border-strong"
              >
                {initials(profile)}
              </button>
              {isUserMenuOpen ? (
                <div className="absolute right-0 top-11 z-40 w-56 rounded-2xl border border-border-subtle bg-bg-raised p-4">
                  <p className="truncate text-sm text-text-primary">
                    {profile.displayName ?? profile.email}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-faint">{profile.email}</p>
                  <span className="type-utility mt-2 inline-block rounded-full bg-primary-soft/12 px-2 py-0.5 text-primary-soft">
                    {profile.role}
                  </span>
                  <form action={signOut} className="mt-4">
                    <button
                      type="submit"
                      className="w-full rounded-full border border-border-subtle px-3 py-2 font-display text-sm font-medium text-text-primary hover:bg-bg-hover"
                    >
                      Sign out
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {demoMode ? (
          <div className="border-b border-border-subtle bg-primary/10 px-6 py-2.5">
            <p className="text-sm text-text-secondary">
              <span className="font-semibold text-text-primary">Demo build.</span> No database is
              connected, so everything here is sample data and nothing you do is saved.
            </p>
          </div>
        ) : null}

        <main className="bg-grid flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
