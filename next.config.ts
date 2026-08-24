import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static ships a native binary; keep it external (not webpack-bundled)
  // and trace the binary into the Inngest function that runs clip cutting.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    // The caption/clip work runs inside the Inngest function: it needs the
    // ffmpeg binary and our bundled caption font traced into that bundle.
    "/api/inngest": ["./node_modules/ffmpeg-static/**", "./src/assets/fonts/**"],
  },
  experimental: {
    // Server actions default to a 1MB body limit, which rejected multi-photo
    // uploads (reference/person photos up to 10MB each). Raise it so a batch
    // of photos posts through. Individual files are still capped at 10MB and
    // the batch at 20 files in the action.
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default nextConfig;
