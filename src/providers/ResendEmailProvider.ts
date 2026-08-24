import { getServerEnv } from "@/lib/config";
import { ProviderCreditsError, ProviderError } from "@/lib/errors";
import type {
  EmailProvider,
  SendEmailInput,
  SendEmailResult,
} from "@/providers/interfaces/EmailProvider";

const API_URL = "https://api.resend.com/emails";
// Sandbox sender: can deliver to the account owner's own address without
// domain verification — sufficient while the digest goes to one person.
const FROM_ADDRESS = "Content Studio <onboarding@resend.dev>";

/** Default email provider (Resend REST). SendGrid slots in behind the same interface. */
export class ResendEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const env = getServerEnv();
    if (!env.RESEND_API_KEY) {
      throw new ProviderError(
        "resend",
        "RESEND_API_KEY is not configured — add it to send email",
      );
    }

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: input.to,
          subject: input.subject,
          html: input.html,
        }),
      });
    } catch {
      throw new ProviderError("resend", "Network error calling email API", true);
    }

    if (!response.ok) {
      if (response.status === 402 || response.status === 403) {
        throw new ProviderCreditsError("resend", "Resend quota exhausted or plan limit hit");
      }
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError("resend", `Email API returned ${response.status}`, retryable);
    }

    const payload = (await response.json()) as { id?: string };
    return { providerMessageId: payload.id ?? "unknown" };
  }
}
