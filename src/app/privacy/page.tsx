export const metadata = {
  title: "Privacy Policy · Content Studio",
  description: "How Content Studio collects, uses, and protects data.",
};

// Set to the operator's support address before deploying.
const CONTACT_EMAIL = "support@example.com";
const LAST_UPDATED = "July 23, 2026";

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-14 text-text-secondary">
      <h1 className="font-display text-3xl font-bold text-text-primary">Privacy Policy</h1>
      <p className="mt-1 text-sm text-text-faint">Last updated {LAST_UPDATED}</p>

      <div className="mt-8 flex flex-col gap-6 text-[15px] leading-relaxed">
        <section>
          <p>
            This Privacy Policy explains how Content Studio (the &ldquo;Platform&rdquo;), an
            internal marketing and content tool operated by the organization running this
            deployment (&ldquo;we&rdquo;, &ldquo;us&rdquo;), collects, uses, and protects
            information. The Platform is used by our team to create marketing content and publish
            it to social media accounts that we own or manage.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-primary">Information we collect</h2>
          <ul className="mt-2 list-disc pl-5">
            <li>
              <strong className="text-text-primary">Account and login data.</strong> Email address
              and role for team members who sign in to the Platform.
            </li>
            <li>
              <strong className="text-text-primary">Connected social accounts.</strong> When a team
              member connects a Facebook Page or Instagram account, we receive and store the access
              tokens and account identifiers needed to publish content on that account&rsquo;s
              behalf.
            </li>
            <li>
              <strong className="text-text-primary">Content you create.</strong> Prompts, captions,
              images, videos, uploaded recordings, and reference photos used to generate and review
              posts.
            </li>
            <li>
              <strong className="text-text-primary">Operational data.</strong> Records of content
              generation and publishing activity, used to run and monitor the Platform.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-primary">
            Facebook and Instagram data
          </h2>
          <p className="mt-2">
            When you connect a Facebook Page or Instagram Business account, we use Meta&rsquo;s
            official APIs solely to publish content that a team member has created and approved
            within the Platform, and to read the minimal Page and account information required to do
            so (for example, the Page and its linked Instagram account). We do not access your
            personal messages, and we do not use this access for advertising, profiling, or any
            purpose other than publishing your approved content. You can disconnect an account at
            any time, which removes its stored access tokens.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-primary">How we use information</h2>
          <p className="mt-2">
            We use the information above to operate the Platform: to let team members sign in,
            generate and review content, and publish approved content to the connected accounts. We
            use third-party AI providers (such as Anthropic and Google) to generate text and images
            from the prompts you provide, and cloud infrastructure (Vercel and Supabase) to run the
            application and store content. We do not sell your data, and we do not share it except
            with these service providers as needed to operate the Platform, or where required by
            law.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-primary">Storage and security</h2>
          <p className="mt-2">
            Data is stored in access-controlled cloud databases and private storage. Access tokens
            and stored content are only accessible to authorized server processes and are not
            exposed publicly. We take reasonable measures to protect information, though no method of
            transmission or storage is completely secure.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-primary">
            Data retention and deletion
          </h2>
          <p className="mt-2">
            We retain data for as long as it is needed to operate the Platform. You can request
            deletion of your data, including any connected-account tokens and stored content, at any
            time. See our{" "}
            <a href="/data-deletion" className="text-primary-soft hover:text-primary-bright underline">
              data deletion instructions
            </a>{" "}
            or contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-soft hover:text-primary-bright underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-primary">Changes to this policy</h2>
          <p className="mt-2">
            We may update this policy from time to time. The &ldquo;last updated&rdquo; date above
            reflects the most recent version.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-text-primary">Contact</h2>
          <p className="mt-2">
            Questions about this policy or your data? Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-soft hover:text-primary-bright underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
