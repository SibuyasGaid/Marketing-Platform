/**
 * Inline SVG artwork standing in for generated media. Storage is unavailable in
 * demo mode, so signed-URL lookups resolve to these instead of broken images.
 * Data URIs keep the app self-contained — no external hosts, no network calls.
 * Each mirrors the sample account's style guide so the "on-brand output" claim
 * is visible rather than asserted.
 */

function svg(body: string): string {
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 800">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(doc)}`;
}

/** Demo Brand: deep indigo ground, violet glow, gold highlight. */
function demoBrandArt(kicker: string, headline: string, accent: string): string {
  return svg(`
    <defs>
      <radialGradient id="g" cx="18%" cy="88%" r="95%">
        <stop offset="0%" stop-color="#892BE2" stop-opacity="0.55"/>
        <stop offset="60%" stop-color="#1A0F3A" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="640" height="800" fill="#1A0F3A"/>
    <rect width="640" height="800" fill="url(#g)"/>
    <circle cx="545" cy="120" r="120" fill="#892BE2" opacity="0.16"/>
    <text x="56" y="150" fill="#FFD600" font-family="Poppins,Segoe UI,sans-serif"
      font-size="21" font-weight="700" letter-spacing="4.5">${kicker}</text>
    <text x="56" y="330" fill="#FFFFFF" font-family="Poppins,Segoe UI,sans-serif"
      font-size="66" font-weight="700">${headline}</text>
    <rect x="56" y="372" width="${Math.min(accent.length * 33 + 34, 520)}" height="86" rx="14" fill="#FFD600"/>
    <text x="73" y="432" fill="#1A0F3A" font-family="Poppins,Segoe UI,sans-serif"
      font-size="60" font-weight="700">${accent}</text>
    <rect x="56" y="672" width="188" height="60" rx="30" fill="#892BE2"/>
    <text x="88" y="710" fill="#FFFFFF" font-family="Open Sans,Segoe UI,sans-serif"
      font-size="21" font-weight="600">Learn more</text>
  `);
}

/** Sample Co: flat near-black navy, gold hero accent, generous negative space. */
function sampleCoArt(label: string, statistic: string, support: string): string {
  return svg(`
    <rect width="640" height="800" fill="#0A0E1A"/>
    <text x="56" y="132" fill="#F5C24A" font-family="Poppins,Segoe UI,sans-serif"
      font-size="19" font-weight="700" letter-spacing="6">${label}</text>
    <text x="56" y="390" fill="#F5C24A" font-family="Poppins,Segoe UI,sans-serif"
      font-size="150" font-weight="700">${statistic}</text>
    <text x="56" y="466" fill="#FFFFFF" font-family="Poppins,Segoe UI,sans-serif"
      font-size="41" font-weight="600">${support}</text>
    <rect x="56" y="540" width="528" height="1" fill="#FFFFFF" opacity="0.16"/>
    <rect x="56" y="596" width="164" height="52" rx="26" fill="#6C5CE7"/>
    <text x="86" y="629" fill="#FFFFFF" font-family="Open Sans,Segoe UI,sans-serif"
      font-size="19" font-weight="600">Swipe →</text>
  `);
}

/** Neutral 16:9 frame used for video posters. */
function videoPoster(title: string): string {
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="#150B30"/>
    <circle cx="320" cy="180" r="54" fill="#892BE2" opacity="0.9"/>
    <path d="M304 152 l46 28 -46 28 z" fill="#FFFFFF"/>
    <text x="320" y="296" fill="#FFFFFF" text-anchor="middle"
      font-family="Poppins,Segoe UI,sans-serif" font-size="24" font-weight="600">${title}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(doc)}`;
}

export const PLACEHOLDER_IMAGES: Record<string, string> = {
  "generated/demo-launch.png": demoBrandArt("NOW OPEN", "Ship faster", "this quarter"),
  "generated/demo-testimonial.png": demoBrandArt("CUSTOMER STORY", "From idea", "to live"),
  "generated/demo-thought.png": demoBrandArt("PLAYBOOK", "Systems beat", "willpower"),
  "generated/sample-audit.png": sampleCoArt("REVENUE AUDIT", "3x", "replies in 30 days"),
  "generated/sample-stat.png": sampleCoArt("40 AUDITS", "68%", "never followed up"),
  "generated/clip-poster.png": videoPoster("Onboarding in 60 seconds"),
  "generated/avatar-poster.png": videoPoster("Avatar hook"),
};

/** Any path not explicitly mapped still resolves to something renderable. */
export const FALLBACK_IMAGE = demoBrandArt("CONTENT STUDIO", "Sample", "output");

export function placeholderFor(path: string): string {
  return PLACEHOLDER_IMAGES[path] ?? FALLBACK_IMAGE;
}
