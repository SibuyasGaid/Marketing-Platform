# Coding Standards

TypeScript strict mode is on and stays on. These standards apply to every file. When a rule here conflicts with speed, the rule wins — this codebase will be maintained by multiple people and extended after MVP.

## 1. Layered architecture (dependency direction is one-way)

```
app/ (routes, server actions)  →  services/  →  repositories/  +  providers/
components/ (presentational)   →  (props only)
inngest/ (job functions)       →  services/
```

- **Routes and server actions** parse input (zod), check auth, call one service method, shape the response. Nothing else. If a route file exceeds ~40 lines of logic, it's doing a service's job.
- **Services** hold all business logic. They are classes with constructor-injected dependencies.
- **Repositories** are the only code that touches Supabase queries. One repository per aggregate (`ContentItemRepository`, `TranscriptRepository`, ...).
- **Providers** are the only code that touches external SDKs/APIs.
- **Components** render props. No fetch, no Supabase client, no business rules.
- Inngest functions are thin: parse event → call service → return. Logic lives in services so it is testable without the Inngest runtime.

## 2. OOP principles, applied concretely

**Single Responsibility** — one class, one reason to change. `SegmentAnalysisService` scores segments; it does not also generate captions. If a class name needs "And", split it.

**Open/Closed via provider interfaces** — new external vendors are added by implementing an interface, never by editing services:

```ts
// providers/interfaces/EmailProvider.ts
export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
// providers/ResendEmailProvider.ts implements it.
// providers/SendGridEmailProvider.ts implements it.
// Services receive EmailProvider — they never import resend or @sendgrid/mail.
```

Same pattern for `PublishProvider` (n8n / Zernio), `ImageGenProvider` (Gemini), `TextModelProvider` (Anthropic / OpenAI), `VideoProvider` (HeyGen).

**Liskov** — every implementation of an interface must be a true drop-in: same error types thrown, same semantics for retries and idempotency keys.

**Interface Segregation** — keep provider interfaces minimal. If only one caller needs a method, it doesn't belong on the shared interface.

**Dependency Inversion** — services depend on interfaces; concrete wiring happens in one composition root (`lib/container.ts`). No `new ResendEmailProvider()` inside a service.

```ts
export class ContentApprovalService {
  constructor(
    private readonly contentRepo: ContentItemRepository,
    private readonly approvalRepo: ApprovalEventRepository,
    private readonly publisher: PublishProvider,
  ) {}

  async approve(itemId: string, reviewerId: string): Promise<ContentItem> {
    const item = await this.contentRepo.getForUpdate(itemId);
    assertTransition(item.status, "approved"); // throws InvalidTransitionError
    await this.approvalRepo.record({ itemId, reviewerId, action: "approved" });
    const updated = await this.contentRepo.setStatus(itemId, "approved");
    await this.publisher.dispatch(toPublishPayload(updated));
    return updated;
  }
}
```

## 3. Domain modeling

- Model the content lifecycle as an explicit state machine in `lib/statusMachine.ts`. All transitions go through `assertTransition`. No ad-hoc `status = "posted"` writes anywhere.
- Use discriminated unions for content types:

```ts
type ContentItem =
  | ({ type: "image_post" } & ImagePostFields)
  | ({ type: "clip" } & ClipFields)
  | ({ type: "heygen_video" } & HeyGenVideoFields)
  | ({ type: "copy_set" } & CopySetFields);
```

- DTOs at boundaries: repositories return domain types, never raw Supabase rows. Map in one place per repository.

## 4. Validation and errors

- Every boundary input is parsed with zod: `const input = ApproveItemSchema.parse(body)`. Types are inferred from schemas, not duplicated.
- One error hierarchy in `lib/errors.ts`: `AppError` base with `code` and `httpStatus`; subclasses `ValidationError`, `AuthError`, `NotFoundError`, `InvalidTransitionError`, `ProviderError`. Routes map `AppError → response` in one shared handler. Unknown errors become 500 with a generic message — internals never leak to clients.
- Provider errors are wrapped: catch the SDK error, throw `ProviderError` with provider name and a safe message. Raw vendor errors never surface to the UI.

## 5. Naming and structure

- Files: `PascalCase.ts` for classes, `camelCase.ts` for utilities, `kebab-case` for route segments.
- Booleans read as predicates: `isApproved`, `hasTranscript`, `canPublish`.
- No abbreviations in domain names: `competitorReport`, not `compRpt`.
- No `any`. No `as` casts except at well-commented SDK boundaries. No `@ts-ignore`.
- Functions over ~40 lines get decomposed. Files over ~250 lines get split.

## 6. Testing

- Vitest. Services are the priority test target — with injected fakes for repositories and providers, they test without network or DB.
- The status state machine gets exhaustive transition tests (every legal and illegal transition).
- Every provider gets a contract test file asserting interface semantics against a mock server or recorded fixtures.
- Minimum bar per phase: state machine, approval service, and one happy-path test per new service.

## 7. React/Next specifics

- Server Components by default; `"use client"` only where interactivity requires it.
- Data flows down through props from server components or route loaders; client components never import repositories.
- Mutations via server actions that delegate to services.
- Loading/error states are explicit for every async surface — the queue tab especially must show `publishing`/`failed` states truthfully from the `jobs` mirror table.
