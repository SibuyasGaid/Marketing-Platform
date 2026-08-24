import type { DispatchResult, PublishPayload, PublishProvider } from "@/providers/interfaces/PublishProvider";

/**
 * Routes each platform to the right publisher: Facebook/Instagram go direct via
 * the Meta Graph API, LinkedIn via the LinkedIn REST API, YouTube via the
 * YouTube Data API; anything else falls back to n8n. A one-line swap keeps the
 * approval gate and dispatch flow untouched (AGENTS.md rule 2).
 */
export class DirectPublishProvider implements PublishProvider {
  constructor(
    private readonly meta: PublishProvider,
    private readonly linkedin: PublishProvider,
    private readonly youtube: PublishProvider,
    private readonly fallback: PublishProvider,
  ) {}

  async dispatch(payload: PublishPayload): Promise<DispatchResult> {
    if (payload.platform === "facebook" || payload.platform === "instagram") {
      return this.meta.dispatch(payload);
    }
    if (payload.platform === "linkedin") {
      return this.linkedin.dispatch(payload);
    }
    if (payload.platform === "youtube") {
      return this.youtube.dispatch(payload);
    }
    return this.fallback.dispatch(payload);
  }
}
