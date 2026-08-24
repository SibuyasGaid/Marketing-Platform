# Frontend & Design System — Content Studio

> Build all UI per this file. Do not deviate from the token system.

---

## 1. Design intent

This internal platform is styled to feel like a native extension of a dark, premium marketing site — the team should feel zero brand whiplash moving between them. That reference aesthetic is violet-on-indigo with bold geometric display type, pill-shaped glowing CTAs, and a faint background grid. The internal app translates that into a **calm, dense, dark dashboard**: same palette and type voice, but quieter — the marketing site sells, the app works. Spend the visual energy in exactly two places: the primary action buttons and the content status system. Everything else stays disciplined.

## 2. Design tokens (source of truth — implement as CSS variables + Tailwind theme)

### Color

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#120A2A` | App background (deep indigo-black) |
| `--bg-nav` | `#0D0722` | Top nav / sidebar |
| `--bg-raised` | `#1B1140` | Cards, panels, modals |
| `--bg-hover` | `#241755` | Hover state on raised surfaces |
| `--primary` | `#7C3AED` | Primary actions, active nav |
| `--primary-bright` | `#8B5CF6` | Hover on primary, links |
| `--primary-soft` | `#A78BFA` | Secondary emphasis, icons |
| `--gradient-brand` | `linear-gradient(92deg, #7C3AED 0%, #B794F6 100%)` | Gradient text accents, hero headings only |
| `--text-primary` | `#F5F3FF` | Headings, primary text |
| `--text-secondary` | `#A79FC4` | Body, descriptions, muted lavender-gray |
| `--text-faint` | `#6E668F` | Timestamps, tertiary metadata |
| `--border-subtle` | `rgba(255,255,255,0.08)` | Card borders, dividers |
| `--border-strong` | `rgba(167,139,250,0.35)` | Focused/active borders |
| `--success` | `#4ADE80` | Posted, live indicators |
| `--warning` | `#FBBF24` | Pending approval, edits requested |
| `--danger` | `#F87171` | Failed, destructive actions |
| `--info` | `#60A5FA` | Publishing/in-progress |

Background texture: the marketing site's faint grid — reproduce as a subtle CSS background (1px lines at `rgba(255,255,255,0.025)`, ~64px cells) on `--bg-base` only. Never on cards.

Glow: primary buttons get `box-shadow: 0 0 24px rgba(124,58,237,0.45)`; intensify slightly on hover. No glow anywhere else.

### Typography

- **Display / headings:** Poppins (600, 700) — matches the site's bold geometric headline voice. Page titles ~28px/700, section titles 20px/600, card titles 16px/600.
- **Body / UI:** Inter (400, 500) — 14px base for dashboard density, 13px for table/metadata rows, `--text-secondary` by default.
- **Utility (badges, eyebrows):** Inter 11–12px, 500, uppercase, `letter-spacing: 0.08em` — mirrors the site's "NOW ENROLLING" chip style.
- Gradient text (`--gradient-brand` with `background-clip: text`) is reserved for at most one word in a page's title, exactly like the site treats "AI Agency". Never on body text or labels.
- Load both fonts via `next/font/google` with `display: swap`.

### Shape & spacing

- Buttons: `rounded-full` (pill), padding `10px 22px`, Poppins 500 14px.
- Cards/panels/modals: `rounded-2xl`, `1px solid var(--border-subtle)`, padding 20–24px.
- Inputs: `rounded-xl`, `--bg-base` fill, subtle border, `--border-strong` + soft purple ring on focus.
- Spacing scale: 4px base; page gutters 24px; card gaps 16px.

## 3. Component specifications

**App shell:** Fixed left sidebar (`--bg-nav`, 240px, collapsible to icons) with the product logo top-left, nav items for the three tabs (Brand Images, Content Engine, Approval Queue) plus Admin. Active item: `--primary` pill background exactly like the site's active "Home" nav state. Top bar: page title, global "Generate" button (primary pill), user avatar menu.

**Buttons:** Primary = solid `--primary` pill with glow ("Watch Free Training" style). Secondary = transparent with `--border-subtle`, text `--text-primary` ("Explore the Blueprint" style). Destructive = outlined `--danger`. Ghost = text-only `--primary-soft`. Loading state: spinner replaces label, width locked to prevent jump.

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

Pills use the utility type style (11px uppercase). Identical component everywhere a status appears — queue, cards, detail views, admin.

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
- Dark theme only for MVP — do not build a light theme toggle.

## 6. Tailwind wiring

Define every token above in `globals.css` as CSS variables and map them in the Tailwind theme (`colors.bg.base`, `colors.primary.DEFAULT`, etc.). Components must consume tokens via Tailwind classes only — hardcoded hex values anywhere in a component file are a review failure. Status pill mapping lives in one `statusStyles.ts` record imported by the single `StatusPill` component.
