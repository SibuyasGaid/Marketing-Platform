/** Core domain vocabulary shared across layers. Values mirror DB enums. */

export const PLATFORMS = ["instagram", "facebook", "linkedin", "youtube"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Platforms that take a static image post (YouTube is video-only). */
export const IMAGE_PLATFORMS = ["instagram", "facebook", "linkedin"] as const;
export type ImagePlatform = (typeof IMAGE_PLATFORMS)[number];

/**
 * Built-in account slugs. Accounts are now data-driven (the `accounts` table);
 * these are the seed and the fallback used if the accounts table is unavailable.
 */
export const BRANDS = ["demo_brand", "sample_co"] as const;
/** An account slug. Data-driven now (any account's slug), not a fixed union. */
export type Brand = string;

export const BRAND_NAMES: Record<Brand, string> = {
  demo_brand: "Demo Brand",
  sample_co: "Sample Co",
};

/**
 * Locked visual identity per brand, layered onto EVERY generated image on top
 * of whatever brand preset the admin picks. Source is each brand's official
 * graphics sheet — update the strings here (one place) when a brand ships a new
 * reference. Empty strings are skipped in the prompt, so a brand without a
 * published sheet simply falls back to the chosen preset.
 */
export interface BrandStyleGuide {
  /** Authoritative color direction, written for an image model. */
  palette: string;
  /** Type direction — only takes effect when the image contains text. */
  typography: string;
  /** One-line overall art direction. */
  artDirection: string;
  /** Recurring composition and layout patterns from the brand's real feed. */
  layout: string;
}

export const BRAND_STYLE_GUIDES: Record<Brand, BrandStyleGuide> = {
  // Demo Brand — a violet-on-indigo sample identity. Two sample accounts ship
  // with the app purely to show what a filled-in style guide looks like; real
  // accounts are created in the UI and stored in the `accounts` table.
  demo_brand: {
    palette:
      "Deep indigo to near-black backgrounds (base #1A0F3A) with a soft violet gradient glow toward a corner or the lower area. Vivid violet #892BE2 for accent shapes, glows, and highlight blocks. Golden yellow #FFD600 reserved for highlighted keywords, large numbers, and small callouts. Primary headline text is white; a few key words are emphasized in yellow or sit inside a solid violet or yellow highlight box. High contrast throughout.",
    typography:
      "When the image contains text, set headlines in a bold, heavy geometric sans-serif in the style of Poppins, tightly set and punchy, and emphasize a few key words by coloring them yellow or wrapping them in a solid violet or yellow marker-style highlight box. Body and captions use a clean sans-serif in the style of Open Sans at a lighter weight.",
    artDirection:
      "Premium, modern, confident, and high energy. Dark, immersive violet-on-indigo backgrounds with glowing violet accents and punchy golden highlights, consistent enough that every image looks like it belongs in the same Instagram feed.",
    layout:
      "Portrait 4:5 framing. Dark gradient background, often with a subtle tech texture such as a fine hexagon mesh, faint circuit lines, soft bokeh dots, or abstract 3D shapes (for example dollar signs for money topics). Common compositions: (1) a testimonial or quote card with a large decorative violet or yellow quotation mark and the person's name and role beneath; (2) a professional person photographed on a dark background with violet rim lighting, cut out and placed to one side with a bold headline on the other; (3) a single large statistic or number in bold yellow or white with a short supporting line. Use rounded corners, pill-shaped buttons and badges, keep a clean area near the top for a small logo lockup, and leave generous spacing.",
  },
  // Sample Co — a deliberately different gold-on-navy sample identity, so the
  // per-account prompt injection is visibly distinguishable from Demo Brand.
  sample_co: {
    palette:
      "Very dark, near-black navy backgrounds (approximately #0A0E1A), mostly flat with little or no gradient. Warm gold/amber (approximately #F5C24A) is the primary accent, used for big numbers, a few highlighted keywords, and small uppercase section labels. Indigo-violet (approximately #6C5CE7) is the secondary accent, used for pill badges, swipe prompts, and call-to-action buttons. Headlines and most body text are white. High contrast and restrained, with gold as the dominant accent.",
    typography:
      "When the image contains text, set headlines in a very large, heavy, clean sans-serif in the style of Poppins or Helvetica, white and tightly set. Emphasize a few key words by coloring them gold (colored text, not highlight boxes). Use small uppercase gold labels with wide letter-spacing for section tags (for example REVENUE AUDIT, FREE, 40 AUDITS ONE PATTERN). Supporting lines are smaller, often italic, in white or light gray.",
    artDirection:
      "Clean, minimal, premium, and data-driven, with generous negative space and a quiet, confident tone. Darker and flatter than a gradient-heavy look: near-black navy with gold as the hero accent and indigo-violet as a secondary accent. Every image should feel restrained and editorial, like it belongs in the same feed.",
    layout:
      "Portrait 4:5 framing on a flat near-black navy background with generous negative space. Common compositions: (1) a small gold uppercase label in the top-left (sometimes a second gold label top-right), a very large white headline or a big gold statistic as the focal point, and a short supporting line beneath; (2) structured data rows such as DURATION / COST / OUTCOME with gold values; (3) a professional person photographed on a dark background, naturally lit, with a bold white headline; (4) sequence pill badges in violet and gold (for example 1ST REPLY, 2ND REPLY, 3RD REPLY). Include a violet swipe prompt or a violet call-to-action button where relevant, keep a clean area for the account's logo lockup, and favor minimalism over decoration.",
  },
};

export const CONTENT_TYPES = ["image_post", "clip", "heygen_video", "copy_set"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "scheduled",
  "publishing",
  "posted",
  "edits_requested",
  "regenerating",
  "failed",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const ROLES = ["admin", "editor", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export const APPROVAL_ACTIONS = ["approved", "edits_requested"] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
}
