export const metadata = {
  title: "Data Deletion · Content Studio",
  description: "How to request deletion of your data from Content Studio.",
};

// Set to the operator's support address before deploying.
const CONTACT_EMAIL = "support@example.com";

export default function DataDeletionPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-14 text-text-secondary">
      <h1 className="font-display text-3xl font-bold text-text-primary">Data Deletion</h1>

      <div className="mt-8 flex flex-col gap-6 text-[15px] leading-relaxed">
        <p>
          You can request deletion of your data from Content Studio at any time. This includes any Facebook or Instagram access tokens for accounts you connected,
          and content stored in the Platform.
        </p>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-primary">How to request deletion</h2>
          <ul className="mt-2 list-disc pl-5">
            <li>
              <strong className="text-text-primary">Disconnect an account:</strong> within the
              Platform, disconnecting a Facebook Page or Instagram account immediately removes its
              stored access tokens.
            </li>
            <li>
              <strong className="text-text-primary">Full deletion:</strong> email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-soft hover:text-primary-bright underline">
                {CONTACT_EMAIL}
              </a>{" "}
              with the subject &ldquo;Data deletion request&rdquo; and the account(s) involved.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-primary">What we do</h2>
          <p className="mt-2">
            We will delete the requested data, including connected-account tokens and associated
            stored content, within 30 days of a verified request, except where we are required to
            retain it by law.
          </p>
        </section>
      </div>
    </main>
  );
}
