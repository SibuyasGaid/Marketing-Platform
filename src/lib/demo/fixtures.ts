/**
 * In-memory stand-ins for the database, keyed by table name and shaped like the
 * rows PostgREST would return (snake_case columns, jsonb as plain objects).
 *
 * Deliberately raw rows rather than domain objects: the demo client hands these
 * to the real repositories, so the real column mapping, defaulting, and domain
 * conversion all still execute. Demo mode exercises the actual read path.
 */

const DAY = 86_400_000;
const now = Date.now();
const iso = (offsetDays: number) => new Date(now + offsetDays * DAY).toISOString();
const day = (offsetDays: number) => new Date(now + offsetDays * DAY).toISOString().slice(0, 10);

/** Monday of the current week, so seeded posts land on the visible board. */
function mondayOffset(): number {
  const weekday = new Date(now).getDay(); // 0 = Sunday
  return weekday === 0 ? -6 : 1 - weekday;
}
const MON = mondayOffset();

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

const PRESET_ID = "00000000-0000-4000-8000-0000000000a1";

const profiles = [
  {
    id: DEMO_USER_ID,
    email: "demo@example.com",
    display_name: "Demo Admin",
    role: "admin",
  },
];

const accounts = [
  {
    id: "00000000-0000-4000-8000-0000000000b1",
    slug: "demo_brand",
    name: "Demo Brand",
    description:
      "Demo Brand is a sample account showing how an account profile steers generation. Voice: confident, practical, premium, and encouraging.",
    visual_identity:
      "Deep ocean-blue backgrounds (base #0B2A4A) with a soft aqua gradient glow. Bright aqua #2EC4B6 accents, coral #FF6B57 for highlighted keywords and large numbers. Heavy Archivo Black-style headlines, Inter-style body. Portrait 4:5.",
    outro_video_path: null,
    is_active: true,
  },
  {
    id: "00000000-0000-4000-8000-0000000000b2",
    slug: "sample_co",
    name: "Sample Co",
    description:
      "Sample Co is a second sample account with a deliberately different look, so the per-account prompt injection is easy to see side by side. Voice: clean, direct, data-driven.",
    visual_identity:
      "Flat bone-white backgrounds (approximately #F4F1EC) with generous negative space. Near-black ink #161616 for type, signal orange #FF5A1F as the only accent. Huge condensed headlines with select words in orange. Portrait 4:5, minimal, editorial.",
    outro_video_path: null,
    is_active: true,
  },
];

const brand_presets = [
  {
    id: PRESET_ID,
    name: "Launch campaign",
    tone: "confident, premium, direct",
    palette: ["#2EC4B6", "#0B2A4A", "#FF6B57"],
    style_rules: "Bold geometric shapes, deep ocean-blue backgrounds, high contrast headline text.",
    campaign_context: "Q1 product launch push",
    platform_variants: {},
    is_active: true,
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    name: "Editorial / data",
    tone: "quiet, factual, premium",
    palette: ["#FF5A1F", "#F4F1EC", "#161616"],
    style_rules: "Flat bone-white ground, one big orange number, lots of negative space.",
    campaign_context: "Field notes series",
    platform_variants: {},
    is_active: true,
  },
];

const asset = (path: string) => [{ bucket: "generated-media", path, mimeType: "image/png" }];

const content_items = [
  {
    id: "00000000-0000-4000-8000-0000000000c1",
    type: "image_post",
    platform: "instagram",
    target_platforms: ["instagram", "facebook"],
    brand: "demo_brand",
    status: "pending_approval",
    title: "Launch announcement",
    caption:
      "Doors are open. Everything you need to ship, in one place.\n\nLink in bio.\n\n#launch #buildinpublic #saas #startup #product",
    generation_inputs: { prompt: "Bold launch announcement graphic", brandPresetId: PRESET_ID },
    output_assets: asset("generated/demo-launch.png"),
    edit_comment: null,
    scheduled_date: day(MON),
    scheduled_for: null,
    source_video_id: null,
    brand_preset_id: PRESET_ID,
    platform_post_url: null,
    created_by: DEMO_USER_ID,
    created_at: iso(-2),
  },
  {
    id: "00000000-0000-4000-8000-0000000000c2",
    type: "image_post",
    platform: "linkedin",
    target_platforms: ["linkedin"],
    brand: "demo_brand",
    status: "pending_approval",
    title: "Thought-leadership post",
    caption:
      "The teams that survive year one all share one habit: they systematise onboarding before they scale acquisition.\n\nMost teams do it backwards. They pour budget into acquisition while every new customer lands in an inbox and hopes for the best. The result is a leaky bucket that gets more expensive to fill every month.\n\nFix the first seven days first.",
    generation_inputs: {
      prompt: "Professional thought-leadership visual",
      brandPresetId: PRESET_ID,
    },
    output_assets: asset("generated/demo-thought.png"),
    edit_comment: null,
    scheduled_date: day(MON + 1),
    scheduled_for: null,
    source_video_id: null,
    brand_preset_id: PRESET_ID,
    platform_post_url: null,
    created_by: DEMO_USER_ID,
    created_at: iso(-2),
  },
  {
    id: "00000000-0000-4000-8000-0000000000c3",
    type: "image_post",
    platform: "instagram",
    target_platforms: ["instagram"],
    brand: "sample_co",
    status: "edits_requested",
    title: "Field notes stat",
    caption: "12 launches. One pattern: 68% shipped late.",
    generation_inputs: { prompt: "Big orange statistic on flat bone-white" },
    output_assets: asset("generated/sample-stat.png"),
    edit_comment: "Make the statistic larger and drop the swipe prompt on this one.",
    scheduled_date: day(MON + 2),
    scheduled_for: null,
    source_video_id: null,
    brand_preset_id: null,
    platform_post_url: null,
    created_by: DEMO_USER_ID,
    created_at: iso(-1),
  },
  {
    id: "00000000-0000-4000-8000-0000000000c4",
    type: "clip",
    platform: "instagram",
    target_platforms: ["instagram", "youtube"],
    brand: "demo_brand",
    status: "pending_approval",
    title: "The 3-message onboarding sequence",
    caption: "Most teams lose customers in week one. Here is the fix.",
    generation_inputs: { kind: "clip", segmentId: "seg-1", startS: 120, endS: 165 },
    output_assets: [
      { bucket: "generated-media", path: "generated/clip-poster.png", mimeType: "video/mp4" },
    ],
    edit_comment: null,
    scheduled_date: day(MON + 2),
    scheduled_for: null,
    source_video_id: "00000000-0000-4000-8000-0000000000d1",
    brand_preset_id: null,
    platform_post_url: null,
    created_by: DEMO_USER_ID,
    created_at: iso(-1),
  },
  {
    id: "00000000-0000-4000-8000-0000000000c5",
    type: "copy_set",
    platform: "linkedin",
    target_platforms: ["linkedin"],
    brand: "demo_brand",
    status: "approved",
    title: "Onboarding systems, copy set",
    caption: "Weekly copy set generated from the training.",
    generation_inputs: { kind: "copy_set", segmentId: "seg-1" },
    output_assets: [],
    edit_comment: null,
    scheduled_date: day(MON + 3),
    scheduled_for: null,
    source_video_id: "00000000-0000-4000-8000-0000000000d1",
    brand_preset_id: null,
    platform_post_url: null,
    created_by: DEMO_USER_ID,
    created_at: iso(-1),
  },
  {
    id: "00000000-0000-4000-8000-0000000000c6",
    type: "image_post",
    platform: "facebook",
    target_platforms: ["facebook"],
    brand: "demo_brand",
    status: "posted",
    title: "Customer win story",
    caption: "From zero to three retained customers in 60 days. Real results, real systems.",
    generation_inputs: { prompt: "Customer results social proof post", brandPresetId: PRESET_ID },
    output_assets: asset("generated/demo-testimonial.png"),
    edit_comment: null,
    scheduled_date: day(MON - 4),
    scheduled_for: null,
    source_video_id: null,
    brand_preset_id: PRESET_ID,
    platform_post_url: "https://example.com/posts/demo",
    created_by: DEMO_USER_ID,
    created_at: iso(-6),
  },
  {
    id: "00000000-0000-4000-8000-0000000000c7",
    type: "image_post",
    platform: "instagram",
    target_platforms: ["instagram"],
    brand: "sample_co",
    status: "draft",
    title: "Case study teaser",
    caption: "Three times the replies in thirty days.",
    generation_inputs: { prompt: "Orange 3x statistic, flat bone-white ground" },
    output_assets: asset("generated/sample-audit.png"),
    edit_comment: null,
    scheduled_date: null,
    scheduled_for: null,
    source_video_id: null,
    brand_preset_id: null,
    platform_post_url: null,
    created_by: DEMO_USER_ID,
    created_at: iso(-3),
  },
  {
    id: "00000000-0000-4000-8000-0000000000c8",
    type: "heygen_video",
    platform: "instagram",
    target_platforms: ["instagram"],
    brand: "demo_brand",
    status: "pending_approval",
    title: "Avatar hook, onboarding",
    caption: "Ninety percent of churn is decided in week one. Here is what to do instead.",
    generation_inputs: {
      kind: "avatar_hook",
      script: "Ninety percent of churn is decided in week one.",
    },
    output_assets: [
      { bucket: "generated-media", path: "generated/avatar-poster.png", mimeType: "video/mp4" },
    ],
    edit_comment: null,
    scheduled_date: day(MON + 4),
    scheduled_for: null,
    source_video_id: null,
    brand_preset_id: null,
    platform_post_url: null,
    created_by: DEMO_USER_ID,
    created_at: iso(-1),
  },
];

const approval_events = [
  {
    id: "00000000-0000-4000-8000-0000000000e1",
    content_item_id: "00000000-0000-4000-8000-0000000000c5",
    reviewer_id: DEMO_USER_ID,
    action: "approved",
    comment: null,
    created_at: iso(-1),
    profiles: { email: "demo@example.com" },
  },
  {
    id: "00000000-0000-4000-8000-0000000000e2",
    content_item_id: "00000000-0000-4000-8000-0000000000c3",
    reviewer_id: DEMO_USER_ID,
    action: "edits_requested",
    comment: "Make the statistic larger and drop the swipe prompt on this one.",
    created_at: iso(-1),
    profiles: { email: "demo@example.com" },
  },
  {
    id: "00000000-0000-4000-8000-0000000000e3",
    content_item_id: "00000000-0000-4000-8000-0000000000c6",
    reviewer_id: DEMO_USER_ID,
    action: "approved",
    comment: null,
    created_at: iso(-6),
    profiles: { email: "demo@example.com" },
  },
];

const source_videos = [
  {
    id: "00000000-0000-4000-8000-0000000000d1",
    title: "Live training: Customer onboarding systems",
    description: "Sample processed webinar.",
    storage_path: "source-videos/demo.mp4",
    source_url: null,
    mime_type: "video/mp4",
    size_bytes: 84_000_000,
    transcript_status: "completed",
    created_at: iso(-8),
  },
  {
    id: "00000000-0000-4000-8000-0000000000d2",
    title: "Q and A session: pricing objections",
    description: "Second sample recording.",
    storage_path: "source-videos/demo-2.mp4",
    source_url: null,
    mime_type: "video/mp4",
    size_bytes: 51_000_000,
    transcript_status: "completed",
    created_at: iso(-3),
  },
];

const transcripts = [
  {
    id: "00000000-0000-4000-8000-0000000000f1",
    source_video_id: "00000000-0000-4000-8000-0000000000d1",
    full_text: "This is a demo transcript standing in for a real one-hour training.",
    segment_map: [{ startS: 0, endS: 25, text: "Welcome to the training on onboarding systems." }],
    analysis: {
      version: 1,
      rankedSegments: [
        {
          id: "seg-1",
          startS: 120,
          endS: 165,
          title: "The 3-message onboarding sequence",
          excerpt: "Most teams lose customers in week one because there is no system...",
          score: 92,
          rationale: "Actionable, promotable, strong hook.",
        },
        {
          id: "seg-2",
          startS: 540,
          endS: 585,
          title: "Pricing anchor that closes",
          excerpt: "When you frame the price against the outcome, the number feels small...",
          score: 88,
          rationale: "Clear teaching value, sales-relevant.",
        },
        {
          id: "seg-3",
          startS: 1320,
          endS: 1360,
          title: "The weekly report customers actually read",
          excerpt: "Nobody reads a 12-tab dashboard. Send three numbers...",
          score: 81,
          rationale: "Relatable, shareable insight.",
        },
      ],
    },
    analysis_version: 1,
    created_at: iso(-8),
  },
];

const competitors = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    name: "Competitor One",
    website_url: "https://example.com",
    social_handles: ["@competitorone"],
    notes: "Runs weekly webinars",
    is_active: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    name: "Competitor Two",
    website_url: "https://example.org",
    social_handles: ["@competitortwo"],
    notes: "Heavy paid ads",
    is_active: true,
  },
];

const content_calendar = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    calendar_date: day(MON + 5),
    brand: "demo_brand",
    platform: "instagram",
    platforms: ["instagram", "facebook"],
    prompt: "Behind the scenes of the build",
    brand_preset_id: PRESET_ID,
    created_by: DEMO_USER_ID,
    created_at: iso(-1),
  },
];

const usageRun = (
  id: string,
  provider: string,
  model: string,
  taskType: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  hoursAgo: number,
) => ({
  id,
  provider,
  model,
  task_type: taskType,
  input_tokens: inputTokens,
  output_tokens: outputTokens,
  estimated_cost_usd: costUsd,
  content_item_id: null,
  job_ref: null,
  created_by: DEMO_USER_ID,
  created_at: new Date(now - hoursAgo * 3_600_000).toISOString(),
});

const ai_usage_log = [
  usageRun("00000000-0000-4000-8000-000000000301", "anthropic", "claude-sonnet-4", "copy_set", 4820, 1140, 0.0182, 1),
  usageRun("00000000-0000-4000-8000-000000000302", "gemini", "gemini-2.5-flash-image", "image_generation", 320, 0, 0.039, 2),
  usageRun("00000000-0000-4000-8000-000000000303", "heygen", "photo-avatar-v3", "avatar_video", 0, 0, 0.24, 3),
  usageRun("00000000-0000-4000-8000-000000000304", "anthropic", "claude-haiku-4-5", "segment_scoring", 12400, 890, 0.0071, 5),
  usageRun("00000000-0000-4000-8000-000000000305", "gemini", "gemini-2.5-flash-image", "image_generation", 310, 0, 0.039, 7),
]

/**
 * Rows by table. Anything not listed resolves to an empty set, which every page
 * already handles, so an unmapped table renders its empty state rather than
 * throwing.
 */
export const DEMO_TABLES: Record<string, Record<string, unknown>[]> = {
  profiles,
  accounts,
  brand_presets,
  content_items,
  approval_events,
  source_videos,
  transcripts,
  competitors,
  content_calendar,
  ai_usage_log,
  avatar_references: [],
  brand_references: [],
  jobs: [],
  provider_alerts: [],
  social_connections: [],
  competitor_reports: [],
};

export function demoRows(table: string): Record<string, unknown>[] {
  return DEMO_TABLES[table] ?? [];
}
