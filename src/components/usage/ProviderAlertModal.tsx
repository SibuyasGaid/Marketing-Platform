"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";

export interface ProviderAlertView {
  id: string;
  provider: string;
  message: string;
}

const PROVIDER_LABELS: Record<string, { name: string; consoleUrl: string }> = {
  anthropic: { name: "Anthropic (copywriting & analysis)", consoleUrl: "https://console.anthropic.com" },
  gemini: { name: "Google Gemini (image generation)", consoleUrl: "https://aistudio.google.com" },
  heygen: { name: "HeyGen (avatar videos)", consoleUrl: "https://app.heygen.com" },
  resend: { name: "Resend (email)", consoleUrl: "https://resend.com" },
  openai: { name: "OpenAI (secondary text)", consoleUrl: "https://platform.openai.com" },
};

const DISMISSED_KEY = "provider-alerts-dismissed";

// Dismissal lives in sessionStorage, read via useSyncExternalStore so the
// server render (which cannot know it) stays closed and hydrates cleanly.
const storeListeners = new Set<() => void>();

function subscribeToDismissals(listener: () => void): () => void {
  storeListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    storeListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readDismissedJson(): string {
  return sessionStorage.getItem(DISMISSED_KEY) ?? "[]";
}

function writeDismissed(ids: string[]): void {
  sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  storeListeners.forEach((listener) => listener());
}

/**
 * App-wide popup when one or more vendors are out of credits
 * (docs/DESIGN.md feedback rules: state what happened and the next step).
 * Dismissal lasts for the browser session; the top-bar chip reopens it.
 * Alerts clear for everyone once an admin resolves them on /admin.
 */
export function ProviderAlertModal({ alerts }: { alerts: ProviderAlertView[] }) {
  const [isForcedOpen, setIsForcedOpen] = useState(false);
  const dismissedJson = useSyncExternalStore(
    subscribeToDismissals,
    readDismissedJson,
    () => null,
  );
  const dismissedIds = useMemo<string[]>(() => {
    try {
      return dismissedJson ? (JSON.parse(dismissedJson) as string[]) : [];
    } catch {
      return [];
    }
  }, [dismissedJson]);

  const reduce = useReducedMotion();

  if (alerts.length === 0) return null;

  // Closed on the server snapshot (null); opens on the client whenever an
  // alert has not been dismissed this session, or via the chip.
  const isOpen =
    isForcedOpen ||
    (dismissedJson !== null && alerts.some((alert) => !dismissedIds.includes(alert.id)));

  const dismiss = () => {
    writeDismissed(alerts.map((alert) => alert.id));
    setIsForcedOpen(false);
  };

  return (
    <>
      {/* Persistent top-bar affordance so a dismissed outage stays visible. */}
      <button
        type="button"
        onClick={() => setIsForcedOpen(true)}
        className="type-utility inline-flex items-center gap-1.5 rounded-full bg-danger/12 px-2.5 py-1 text-danger hover:bg-danger/20"
      >
        <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" />
        {alerts.length === 1 ? "1 API needs credits" : `${alerts.length} APIs need credits`}
      </button>

      <AnimatePresence>
        {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="API credits needed"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <motion.button
            type="button"
            aria-label="Close"
            onClick={dismiss}
            className="absolute inset-0 bg-bg-nav/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
          <motion.div
            className="relative w-full max-w-md rounded-2xl border border-danger/40 bg-bg-raised p-6"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <h2 className="font-display text-xl font-semibold text-text-primary">
              Out of API credits
            </h2>
            <p className="mt-1 text-sm">
              Generation using {alerts.length === 1 ? "this service" : "these services"} is
              paused until credits are topped up.
            </p>

            <ul className="mt-4 flex flex-col gap-3">
              {alerts.map((alert) => {
                const info = PROVIDER_LABELS[alert.provider] ?? {
                  name: alert.provider,
                  consoleUrl: "",
                };
                return (
                  <li
                    key={alert.id}
                    className="rounded-xl border border-border-subtle bg-bg-base p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-text-primary">{info.name}</span>
                      <span className="type-utility rounded-full bg-danger/12 px-2 py-0.5 text-danger">
                        No credits
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px]">{alert.message}</p>
                    {info.consoleUrl ? (
                      <a
                        href={info.consoleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-block text-[13px] text-primary-soft hover:text-primary-bright"
                      >
                        Top up in the {alert.provider} console ↗
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <p className="mt-4 text-[13px] text-text-faint">
              After topping up, an admin resolves the alert on the Admin page to clear this
              notice for everyone.
            </p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={dismiss}>
                Dismiss
              </Button>
              <Link
                href="/admin"
                onClick={dismiss}
                className="inline-flex items-center rounded-full bg-primary px-[22px] py-[10px] font-display text-sm font-medium text-text-primary shadow-glow transition-colors hover:bg-primary-bright"
              >
                Go to Admin
              </Link>
            </div>
          </motion.div>
        </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
