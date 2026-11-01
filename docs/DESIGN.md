# Frontend & Design System — Content Studio

> Build all UI per this file. Do not deviate from the token system.

---

## 1. Design intent

Content Studio is a **proofing desk**. Reviewers spend their day looking at other people's visuals (generated images, clips, avatar videos) and deciding whether they ship. The interface should stay out of the way of that work: a light paper-grey canvas, white working surfaces, near-black ink, and exactly one accent, a cobalt "blue pencil" (the colour editors mark proofs with), reserved for the actions that move work forward.

Spend the visual energy in two places only: the primary action on each screen, and the content status system. Everything else stays quiet so the thumbnails carry the colour.

## 2. Design tokens (source of truth: CSS variables + Tailwind theme)

### Color

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#F1F2F4` | App canvas (paper grey) |
| `--bg-nav` | `#F8F8FA` | Sidebar |
| `--bg-raised` | `#FFFFFF` | Cards, panels, modals, drawers (gets `--shadow-surface`) |
| `--bg-hover` | `#E9EBF0` | Hover on surfaces |
| `--primary` | `#2B47E8` | Primary actions, active nav, selected chips |
| `--primary-bright` | `#1F37C4` | Hover/pressed primary (darker, not lighter) |
| `--primary-soft` | `#3550E6` | Links, ghost actions, secondary emphasis |
| `--on-primary` | `#FFFFFF` | Text and icons on a solid `--primary` fill. Never `--text-primary` there |
| `--text-primary` | `#14161B` | Headings, primary text |
| `--text-secondary` | `#4B5261` | Body, descriptions |
| `--text-faint` | `#6F7685` | Timestamps, tertiary metadata (AA at 12px+ on white) |
| `--border-subtle` | `rgba(20,22,27,0.09)` | Card borders, dividers |
| `--border-strong` | `rgba(43,71,232,0.45)` | Focused/active borders |
| `--success` | `#15803D` | Posted, live indicators |
| `--warning` | `#B45309` | Pending approval, edits requested |
| `--danger` | `#D92D20` | Failed, destructive actions |
| `--info` | `#1D63D8` | Scheduled, publishing, in-progress |

No background texture: the canvas is plain so thumbnails carry the colour.

Shadows: `--shadow-surface` (soft, two-layer) on raised surfaces; `--glow-primary` (a cobalt-tinted drop shadow) on primary buttons only, slightly stronger on hover.

### Typography

- **One family: Schibsted Grotesk** (variable, 400 to 900), self-hosted from `src/assets/fonts` via `next/font/local` so builds never depend on Google Fonts. It's a newsroom grotesque: compact, sturdy at small sizes, with enough character in bold for page titles.
- Page titles 20px/700, section titles 16 to 18px/600, body 14px/400, metadata 12 to 13px.
- Headings get `-0.015em` tracking.
- Utility text (badges, metadata) is 12px/550 in **sentence case**. No all-caps labels or tracked-out eyebrows.
- Status pills are 11px/600, never wrap.
- No gradient or single-accent-word headline treatments.

### Shape & spacing

- Buttons: `rounded-lg` (8px), padding `10px 16px`, 14px/600. Pills (`rounded-full`) are for status, chips and avatars only, never for actions.
- Cards/panels/modals: `rounded-2xl`, `1px solid var(--border-subtle)`, white with `--shadow-surface`, padding 20 to 24px.
- Inputs: `rounded-xl`, `--bg-base` fill, subtle border, `--border-strong` + soft purple ring on focus.
- Spacing scale: 4px base; page gutters 24px; card gaps 16px.

## 3. Component specifications

**App shell:** Fixed left sidebar (`--bg-nav`, 240px, collapsible to icons) with the ink "CS" mark and wordmark top-left, and nav items for every tab plus Admin. Active item: a 10% cobalt tint, cobalt text, and a 3px cobalt marker on the left edge. Top bar: translucent canvas with blur, page title, AI spend today, the global "Generate" button (primary), and the user menu.

**Buttons:** Primary = solid `--primary`, `--on-primary` text, cobalt drop shadow; one per screen region. Secondary = white with a hairline border that turns cobalt on hover. Destructive = outlined `--danger`. Ghost = text-only `--primary-soft`. Loading state: spinner replaces label, width locked to prevent jump.

**Status pills** (the second place visual energy goes — this is the operational heart of the app):

| Status | Pill treatment |
|---|---|
| `draft` | `--text-faint` outline |
| `pending_approval` | `--warning` tint bg (12% alpha), warning text, pulsing dot |
| `approved` | `--primary-soft` tint |
| `publishing` | `--info` tint, animated spinner dot |
| `posted` | `--success` tint, check icon |
| `edits_requested` | `--warning` outline, comment icon |
| `regenerating` | `--info` outline, animated spinner dot |
| `failed` | `--danger` tint, retry affordance beside it |

Pills are 11px/600 sentence case and never wrap. Identical component everywhere a status appears — queue, cards, detail views, admin.

**Approval Queue (Tab 3):** Week view — 7 day columns on desktop, stacked day list on mobile. Each content item is a compact card: platform icon, thumbnail (16:9 for video, 1:1 for image posts), truncated caption, status pill. Clicking opens a right-side drawer (not a modal): full preview, platform, schedule, generation inputs, and the action row — **Approve** (primary pill) and **Request edits** (secondary). "Request edits" reveals an inline comment textarea with a required-field state and a "Send for regeneration" button. Approving fires a toast: "Approved — publishing to {platform}." Filters above the board: platform, status, type.

**Content Engine (Tab 2):** Upload/ingest panel with drag-drop zone (dashed `--border-strong` on dragover). Processing pipeline shown as a vertical stepper per video: Transcribe → Analyze → Rank — each step with status dot and timestamp, driven by the `jobs` table. Ranked segments render as cards with score badge, transcript excerpt, and per-segment actions: "Create clip," "Generate copy," "Create avatar hook." Weekly batch: one prominent card at top — "Generate this week's content" — opening a confirm drawer summarizing what will be produced before firing.

**Brand Images (Tab 1):** Left column: preset picker (cards with palette swatch strip + tone label) and avatar reference selector showing Alex/Jordan thumbnails with multi-select. Right: prompt composer and a masonry history grid of generated outputs; each output card has hover actions Regenerate / Send to queue / Download.

**Feedback surfaces:** Toasts bottom-right, `--bg-raised`, 4s auto-dismiss, action verb consistency (button "Approve" → toast "Approved"). Empty states: one line of direction + one primary action, never illustration-heavy ("No content queued for this week yet. Generate this week's content."). Errors state what happened and the next step, no apologies: "Video upload failed — file exceeds 2GB. Compress it or paste a source URL instead." Skeletons: shimmer on `--bg-raised` shapes matching real layout.

## 4. Motion (Framer Motion)

Purposeful and sparse — this is a tool, not a landing page:

- Page/tab transitions: 150ms fade + 8px rise. Nothing slower than 200ms.
- Drawer: 220ms slide from right with ease-out.
- Queue card status change: brief scale pulse (1 → 1.02 → 1) + pill crossfade when realtime status updates land.
- Job stepper: active step dot pulses; completed steps animate the check once.
- Hover on cards: background shift to `--bg-hover` + 1px lift. No rotation, no parallax, no scroll-triggered effects.
- Respect `prefers-reduced-motion`: all of the above collapse to instant state changes.

## 5. Quality floor

- Responsive to 375px: sidebar becomes bottom nav or hamburger; queue becomes a vertical day list; drawers become full-screen sheets.
- Keyboard: full tab order through the queue; Enter opens drawer; visible focus ring (`2px var(--primary-soft)` offset ring) on every interactive element.
- Contrast: `--text-secondary` on `--bg-raised` must pass WCAG AA for body sizes — verify, don't assume.
- All async surfaces have explicit loading, empty, and error states. No layout shift when statuses update.
- Light theme only. Do not add a theme toggle without a token pass for every surface.

## 6. Tailwind wiring

Define every token above in `globals.css` as CSS variables and map them in the Tailwind theme (`colors.bg.base`, `colors.primary.DEFAULT`, etc.). Components must consume tokens via Tailwind classes only — hardcoded hex values anywhere in a component file are a review failure. Status pill mapping lives in one `statusStyles.ts` record imported by the single `StatusPill` component.
