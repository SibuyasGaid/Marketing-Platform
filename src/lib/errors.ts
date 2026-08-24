/**
 * Single error hierarchy for the app (docs/CODING_STANDARDS.md §4).
 * Routes map AppError → HTTP response in one shared handler; unknown errors
 * become a generic 500 so internals never leak to clients.
 */

export type AppErrorCode =
  | "validation_error"
  | "auth_error"
  | "forbidden"
  | "not_found"
  | "invalid_transition"
  | "provider_error"
  | "rate_limited"
  | "budget_exceeded";

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: AppErrorCode,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "validation_error", 400);
  }
}

export class AuthError extends AppError {
  constructor(message = "Not authenticated") {
    super(message, "auth_error", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Not allowed") {
    super(message, "forbidden", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} ${id} not found` : `${resource} not found`, "not_found", 404);
  }
}

export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(`Illegal status transition: ${from} → ${to}`, "invalid_transition", 409);
  }
}

/**
 * Wraps raw vendor/SDK errors. `safeMessage` is what clients may see;
 * the raw error is only ever logged server-side.
 */
export class ProviderError extends AppError {
  constructor(
    readonly provider: string,
    safeMessage: string,
    readonly retryable: boolean = false,
  ) {
    super(`[${provider}] ${safeMessage}`, "provider_error", 502);
  }
}

/**
 * A vendor rejected the call because the account is out of credits/quota
 * (not a transient 429). Raising this triggers a provider alert that surfaces
 * app-wide until an admin resolves it.
 */
export class ProviderCreditsError extends ProviderError {
  constructor(provider: string, safeMessage = "API credits or quota exhausted") {
    super(provider, safeMessage, false);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests — try again shortly") {
    super(message, "rate_limited", 429);
  }
}

export class BudgetExceededError extends AppError {
  constructor(message = "Daily AI budget reached — scheduled and approved flows continue") {
    super(message, "budget_exceeded", 429);
  }
}
