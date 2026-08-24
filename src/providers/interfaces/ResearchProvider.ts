export interface ResearchInput {
  /** Static, cacheable instructions. */
  system: string;
  /** The research request (competitor names/URLs are embedded as data). */
  user: string;
  maxSearches: number;
  idempotencyKey: string;
}

export interface ResearchResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  searchesUsed: number;
}

/**
 * Text completion with live web search (competitor digest). Kept separate
 * from TextModelProvider per interface segregation — only the digest needs it.
 */
export interface ResearchProvider {
  research(input: ResearchInput): Promise<ResearchResult>;
}
