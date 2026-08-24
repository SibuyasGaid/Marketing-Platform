-- Demo seed for the stakeholder walkthrough. Safe to run in the SQL Editor.
-- Idempotent: re-running clears prior demo rows (tagged) and reinserts.
-- Attributes everything to the first admin profile; does nothing if none exists.
--
-- Note: seeded image posts / clips have NO rendered asset (that would burn API
-- credits). They appear in the queue as cards with captions + status pills so
-- you can demo the approval FLOW. For a visual demo, generate one real image
-- on /images first, then Send to queue.

do $$
declare
  demo_admin uuid;
  demo_preset uuid;
  demo_video uuid;
  wk date := date_trunc('week', now())::date; -- Monday of the current week
begin
  select id into demo_admin from public.profiles where role = 'admin' order by created_at limit 1;
  if demo_admin is null then
    raise notice 'No admin profile found — create one first, then re-run the seed.';
    return;
  end if;

  -- Clear prior demo data (tagged rows only).
  delete from public.content_items where generation_inputs->>'demo' = 'true';
  delete from public.transcripts where source_video_id in (
    select id from public.source_videos where title like 'DEMO —%'
  );
  delete from public.source_videos where title like 'DEMO —%';
  delete from public.competitors where name like 'DEMO —%';
  delete from public.brand_presets where name like 'DEMO —%';

  -- Brand preset.
  insert into public.brand_presets (name, tone, palette, style_rules, campaign_context, created_by)
  values (
    'DEMO — Sample brand preset',
    'confident, premium, direct',
    '["#7C3AED", "#120A2A", "#A78BFA"]'::jsonb,
    'Bold geometric shapes, dark violet backgrounds, high contrast headline text.',
    'Q1 product launch push',
    demo_admin
  ) returning id into demo_preset;

  -- Competitor watchlist.
  insert into public.competitors (name, website_url, social_handles, notes, created_by) values
    ('DEMO — Competitor One', 'https://example.com', '["@competitorone"]'::jsonb, 'Runs weekly webinars', demo_admin),
    ('DEMO — Competitor Two', 'https://example.org', '["@competitortwo"]'::jsonb, 'Heavy paid ads', demo_admin);

  -- A "processed" webinar with transcript + ranked segments.
  insert into public.source_videos (title, description, source_url, duration_seconds, transcript_status, uploaded_by)
  values (
    'DEMO — Live training: Customer onboarding systems',
    'Sample processed webinar for the walkthrough.',
    'https://example.com/demo.mp4',
    3600,
    'completed',
    demo_admin
  ) returning id into demo_video;

  insert into public.transcripts (source_video_id, full_text, segment_map, analysis, analysis_version)
  values (
    demo_video,
    'This is a demo transcript standing in for a real one-hour training on customer onboarding systems...',
    '[{"startS":0,"endS":25,"text":"Welcome to the training on onboarding systems."}]'::jsonb,
    jsonb_build_object(
      'version', 1,
      'rankedSegments', jsonb_build_array(
        jsonb_build_object('id','seg-1','startS',120,'endS',165,'title','The 3-message onboarding sequence','excerpt','Most teams lose customers in week one because there is no system...','score',92,'rationale','Actionable, promotable, strong hook.'),
        jsonb_build_object('id','seg-2','startS',540,'endS',585,'title','Pricing anchor that closes','excerpt','When you frame the price against the outcome, the number feels small...','score',88,'rationale','Clear teaching value, sales-relevant.'),
        jsonb_build_object('id','seg-3','startS',1320,'endS',1360,'title','The weekly report customers actually read','excerpt','Nobody reads a 12-tab dashboard. Send three numbers...','score',81,'rationale','Relatable, shareable insight.')
      )
    ),
    1
  );

  -- Queued content across the week: image posts + clips + a copy set.
  insert into public.content_items
    (type, platform, status, title, caption, generation_inputs, scheduled_date, source_video_id, brand_preset_id, created_by)
  values
    ('image_post','instagram','pending_approval','Launch announcement',
     'Doors are open. Everything you need to ship, in one place. 🔗 in bio',
     jsonb_build_object('demo','true','kind','weekly_batch','prompt','Bold launch announcement graphic'),
     wk, null, demo_preset, demo_admin),
    ('image_post','linkedin','pending_approval','Thought-leadership post',
     'The teams that survive year one all share one habit: they systematise onboarding before they scale acquisition.',
     jsonb_build_object('demo','true','kind','weekly_batch','prompt','Professional thought-leadership visual'),
     wk + 1, null, demo_preset, demo_admin),
    ('clip','instagram','pending_approval','The 3-message onboarding sequence',
     'Most teams lose customers in week one. Here is the fix. 👇',
     jsonb_build_object('demo','true','kind','clip','sourceVideoId',demo_video,'segmentId','seg-1','startS',120,'endS',165),
     wk + 2, demo_video, null, demo_admin),
    ('copy_set','linkedin','pending_approval','Onboarding systems — copy set',
     'Weekly copy set generated from the training.',
     jsonb_build_object('demo','true','kind','copy_set','sourceVideoId',demo_video,'segmentId','seg-1'),
     wk + 2, demo_video, null, demo_admin),
    ('image_post','facebook','posted','Customer win story',
     'From zero to three retained customers in 60 days. Real results, real systems.',
     jsonb_build_object('demo','true','kind','calendar','prompt','Customer results social proof post'),
     wk - 2, null, demo_preset, demo_admin);

  raise notice 'Demo seed complete for admin %.', demo_admin;
end $$;
