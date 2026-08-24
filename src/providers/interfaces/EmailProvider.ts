export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
  /** Stable key so a retried job never sends the same email twice. */
  idempotencyKey: string;
}

export interface SendEmailResult {
  providerMessageId: string;
}

/** Resend by default; SendGrid drop-in behind the same interface. */
export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
