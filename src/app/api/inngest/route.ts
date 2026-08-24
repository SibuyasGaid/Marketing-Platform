import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { allFunctions } from "@/inngest/functions";

// ffmpeg clip cutting runs here; give the function room (Vercel clamps to the
// plan's ceiling). Stream-copy cuts finish in seconds, but headroom is cheap.
export const maxDuration = 300;

// Signature verification via INNGEST_SIGNING_KEY is the SDK default and stays
// on (docs/SECURITY.md §5).
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: allFunctions,
});
