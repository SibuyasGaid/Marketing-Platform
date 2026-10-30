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
  // Demo Brand: an invented aqua-on-ocean sample identity. Two sample accounts ship
  // with the app purely to show what a filled-in style guide looks like; real
  // accounts are created in the UI and stored in the `accounts` table.
  demo_brand: {
    palette:
      "Deep ocean-blue backgrounds (base #0B2A4A) with a soft aqua gradient glow toward one corner. Bright aqua #2EC4B6 for accent shapes, glows, and highlight blocks. Coral #FF6B57 reserved for highlighted keywords, large numbers, and small callouts. Primary headline text is white; a few key words are emphasized in coral or sit inside a solid aqua or coral highlight box. High contrast throughout.",
    typography:
      "When the image contains text, set headlines in a heavy, wide grotesque sans-serif in the style of Archivo Black, tightly set and punchy, and emphasize a few key words by coloring them coral or wrapping them in a solid aqua or coral marker-style highlight box. Body and captions use a clean sans-serif in the style of Inter at a lighter weight.",
    artDirection:
      "Fresh, modern, confident, and high energy. Deep ocean-blue backgrounds with glowing aqua accents and punchy coral highlights, consistent enough that every image looks like it belongs in the same Instagram feed.",
    layout:
      "Portrait 4:5 framing. Deep blue gradient background, often with a subtle texture such as soft wave lines, fine dot grids, or abstract 3D shapes tied to the topic. Common compositions: (1) a testimonial or quote card with a large decorative aqua or coral quotation mark and the person's name and role beneath; (2) a person photographed on a dark background with aqua rim lighting, cut out and placed to one side with a bold headline on the other; (3) a single large statistic or number in bold coral or white with a short supporting line. Use rounded corners, pill-shaped buttons and badges, keep a clean area near the top for a small logo lockup, and leave generous spacing.",
  },
  // Sample Co: a deliberately different light, editorial sample identity, so the
  // per-account prompt injection is visibly distinguishable from Demo Brand.
  sample_co: {
    palette:
      "Light, warm bone-white backgrounds (approximately #F4F1EC), mostly flat with no gradient. Near-black ink (approximately #161616) for headlines and body text. Signal orange (approximately #FF5A1F) is the single accent, used for big numbers, a few highlighted keywords, small uppercase section labels, and call-to-action buttons. High contrast and restrained, with orange used sparingly.",
    typography:
      "When the image contains text, set headlines in a very large, condensed bold sans-serif in the style of Oswald, near-black and tightly set. Emphasize a few key words by coloring them orange (colored text, not highlight boxes). Use small uppercase orange labels with wide letter-spacing for section tags (for example CASE STUDY, FIELD NOTES, 3 LESSONS). Supporting lines are smaller, in a clean sans-serif in the style of IBM Plex Sans, in dark gray.",
    artDirection:
      "Clean, minimal, editorial, and data-driven, with generous negative space and a quiet, confident tone. A light print-magazine look: bone-white paper, near-black ink, and signal orange as the only accent. Every image should feel restrained and editorial, like it belongs in the same feed.",
    layout:
      "Portrait 4:5 framing on a flat bone-white background with generous negative space. Common compositions: (1) a small orange uppercase label in the top-left, a very large near-black headline or a big orange statistic as the focal point, and a short supporting line beneath; (2) structured data rows such as TIME / COST / RESULT with orange values; (3) a person photographed in natural light against a plain wall, with a bold headline; (4) numbered steps in thin-outlined boxes (for example STEP 1, STEP 2, STEP 3). Include an orange call-to-action button where relevant, keep a clean area for the account's logo lockup, and favor minimalism over decoration.",
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
