"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState } from "react";
import {
  chooseMetaPage,
  disconnectLinkedIn,
  disconnectMeta,
  disconnectYouTube,
  removeAccountOutro,
  removeAccountReference,
  removePersonReference,
  setAccountLogo,
  updateAccount,
  uploadAccountOutro,
  uploadAccountReference,
  uploadPersonReference,
  type ActionState,
} from "@/app/(app)/accounts/actions";
import { Button } from "@/components/ui/Button";
import { SubmitText } from "@/components/ui/SubmitButton";

export interface ConnectionsView {
  facebookName: string | null;
  instagramName: string | null;
  linkedinName: string | null;
  youtubeName: string | null;
}

export interface PendingPage {
  id: string;
  name: string;
  hasInstagram: boolean;
}

export interface AccountReferenceView {
  id: string;
  name: string;
  thumbUrl: string | null;
  isLogo: boolean;
}

export interface PersonView {
  id: string;
  personName: string;
  thumbUrl: string | null;
}

const initialState: ActionState = { error: null };
const inputClass =
  "w-full rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong";

export function AccountEditor({
  slug,
  name,
  description,
  visualIdentity,
  hasOutro,
  references,
  people,
  connections,
  metaStatus,
  linkedinStatus,
  youtubeStatus,
  pendingPages,
  isAdmin,
  canManage,
}: {
  slug: string;
  name: string;
  description: string;
  visualIdentity: string;
  hasOutro: boolean;
  references: AccountReferenceView[];
  people: PersonView[];
  connections: ConnectionsView;
  metaStatus: string | null;
  linkedinStatus: string | null;
  youtubeStatus: string | null;
  pendingPages: PendingPage[];
  isAdmin: boolean;
  canManage: boolean;
}) {
  // Group photos by person. Older batch uploads numbered each photo's name
  // ("Alex Image 1", "Alex Photo 2"…), which split one person into many
  // single-photo blocks; collapse those trailing "image/photo N" suffixes so
  // they read as one person. The display name is the cleaned base.
  const peopleByName = people.reduce<Record<string, PersonView[]>>((groups, person) => {
    const base = personDisplayName(person.personName);
    (groups[base] ??= []).push(person);
    return groups;
  }, {});
  const [state, action, isPending] = useActionState(updateAccount, initialState);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link
        href="/accounts"
        className="type-utility inline-flex w-fit items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <span aria-hidden>←</span> Accounts
      </Link>

      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <h2 className="font-display text-xl font-semibold text-text-primary">{name}</h2>
        <p className="mt-0.5 text-[13px] text-text-faint">
          These details are used as context for every post generated for this account.
        </p>

        <form action={action} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="slug" value={slug} />
          <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
            Account name
            <input name="name" required defaultValue={name} className={inputClass} disabled={!canManage} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
            Description and voice
            <textarea
              name="description"
              rows={4}
              defaultValue={description}
              disabled={!canManage}
              placeholder="What this account is and how it should sound. Used as context for captions and images."
              className={`${inputClass} resize-y`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
            Visual identity
            <textarea
              name="visualIdentity"
              rows={6}
              defaultValue={visualIdentity}
              disabled={!canManage}
              placeholder="Colors, fonts, and overall look. Used to style generated images so they match the account's feed."
              className={`${inputClass} resize-y`}
            />
          </label>
          {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
          {state.ok ? <p className="text-sm text-success">Saved.</p> : null}
          {canManage ? (
            <Button type="submit" isLoading={isPending} className="self-start">
              Save changes
            </Button>
          ) : (
            <p className="text-[13px] text-text-faint">You have read-only access to accounts.</p>
          )}
        </form>
      </section>

      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <h3 className="font-display text-base font-semibold text-text-primary">
          Publishing connections
        </h3>
        <p className="mt-0.5 text-[13px] text-text-faint">
          Connect this account&rsquo;s social accounts so approved posts publish automatically.
        </p>

        {metaStatus === "connected" ? (
          <p className="mt-2 text-sm text-success">Connected Facebook and Instagram.</p>
        ) : metaStatus === "connected_fb_only" ? (
          <p className="mt-2 text-sm text-success">
            Connected Facebook. No linked Instagram was found on that Page.
          </p>
        ) : metaStatus === "nopages" ? (
          <p className="mt-2 text-sm text-danger">No Facebook Pages were found for that login.</p>
        ) : metaStatus === "error" ? (
          <p className="mt-2 text-sm text-danger">Could not connect. Please try again.</p>
        ) : null}

        {canManage && pendingPages.length > 0 ? (
          <div className="mt-3 rounded-xl border border-primary/40 bg-bg-base p-3">
            <span className="text-sm font-medium text-text-primary">
              Choose which Facebook Page this account posts to
            </span>
            <p className="mt-0.5 text-[13px] text-text-faint">
              Your login manages several Pages. Pick the one for {name}. Its linked Instagram (if
              any) is connected too.
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {pendingPages.map((page) => (
                <form
                  key={page.id}
                  action={chooseMetaPage}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-raised p-2.5"
                >
                  <input type="hidden" name="accountSlug" value={slug} />
                  <input type="hidden" name="pageId" value={page.id} />
                  <div className="min-w-0">
                    <span className="block truncate text-sm text-text-primary">{page.name}</span>
                    <span className="text-[12px] text-text-faint">
                      {page.hasInstagram ? "Instagram linked" : "No linked Instagram"}
                    </span>
                  </div>
                  <SubmitText
                    spinner
                    pendingLabel="Connecting…"
                    className="shrink-0 rounded-full bg-primary px-3.5 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-primary-bright"
                  >
                    Use this Page
                  </SubmitText>
                </form>
              ))}
            </div>
          </div>
        ) : null}

        {linkedinStatus === "connected" ? (
          <p className="mt-2 text-sm text-success">Connected LinkedIn Company Page.</p>
        ) : linkedinStatus === "noorgs" ? (
          <p className="mt-2 text-sm text-danger">
            No LinkedIn Company Pages were found for that login. You must be a Page admin.
          </p>
        ) : linkedinStatus === "error" ? (
          <p className="mt-2 text-sm text-danger">Could not connect LinkedIn. Please try again.</p>
        ) : null}

        {youtubeStatus === "connected" ? (
          <p className="mt-2 text-sm text-success">Connected YouTube channel.</p>
        ) : youtubeStatus === "nochannel" ? (
          <p className="mt-2 text-sm text-danger">
            No YouTube channel was found for that Google account.
          </p>
        ) : youtubeStatus === "error" ? (
          <p className="mt-2 text-sm text-danger">Could not connect YouTube. Please try again.</p>
        ) : null}

        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-bg-base p-3">
            <div className="min-w-0">
              <span className="text-sm font-medium text-text-primary">
                Facebook + Instagram (Meta)
              </span>
              <p className="mt-0.5 text-[13px] text-text-faint">
                {connections.facebookName
                  ? `Facebook: ${connections.facebookName}${connections.instagramName ? " · Instagram linked" : " · no linked Instagram"}`
                  : "Not connected"}
              </p>
            </div>
            {canManage ? (
              <div className="flex items-center gap-2">
                <a
                  href={`/api/oauth/meta/start?account=${slug}`}
                  className="rounded-full bg-primary px-[18px] py-[9px] font-display text-[13px] font-medium text-text-primary shadow-glow transition-colors hover:bg-primary-bright"
                >
                  {connections.facebookName ? "Reconnect" : "Connect"}
                </a>
                {connections.facebookName ? (
                  <form action={disconnectMeta}>
                    <input type="hidden" name="accountSlug" value={slug} />
                    <SubmitText
                      spinner
                      pendingLabel="Disconnecting…"
                      className="text-[13px] text-text-faint hover:text-danger"
                    >
                      Disconnect
                    </SubmitText>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-bg-base p-3">
            <div className="min-w-0">
              <span className="text-sm font-medium text-text-primary">LinkedIn</span>
              <p className="mt-0.5 text-[13px] text-text-faint">
                {connections.linkedinName
                  ? `Company Page: ${connections.linkedinName}`
                  : "Not connected"}
              </p>
            </div>
            {canManage ? (
              <div className="flex items-center gap-2">
                <a
                  href={`/api/oauth/linkedin/start?account=${slug}`}
                  className="rounded-full bg-primary px-[18px] py-[9px] font-display text-[13px] font-medium text-text-primary shadow-glow transition-colors hover:bg-primary-bright"
                >
                  {connections.linkedinName ? "Reconnect" : "Connect"}
                </a>
                {connections.linkedinName ? (
                  <form action={disconnectLinkedIn}>
                    <input type="hidden" name="accountSlug" value={slug} />
                    <SubmitText
                      spinner
                      pendingLabel="Disconnecting…"
                      className="text-[13px] text-text-faint hover:text-danger"
                    >
                      Disconnect
                    </SubmitText>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-bg-base p-3">
            <div className="min-w-0">
              <span className="text-sm font-medium text-text-primary">YouTube</span>
              <p className="mt-0.5 text-[13px] text-text-faint">
                {connections.youtubeName
                  ? `Channel: ${connections.youtubeName}`
                  : "Not connected · video posts only"}
              </p>
            </div>
            {canManage ? (
              <div className="flex items-center gap-2">
                <a
                  href={`/api/oauth/youtube/start?account=${slug}`}
                  className="rounded-full bg-primary px-[18px] py-[9px] font-display text-[13px] font-medium text-text-primary shadow-glow transition-colors hover:bg-primary-bright"
                >
                  {connections.youtubeName ? "Reconnect" : "Connect"}
                </a>
                {connections.youtubeName ? (
                  <form action={disconnectYouTube}>
                    <input type="hidden" name="accountSlug" value={slug} />
                    <SubmitText
                      spinner
                      pendingLabel="Disconnecting…"
                      className="text-[13px] text-text-faint hover:text-danger"
                    >
                      Disconnect
                    </SubmitText>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <h3 className="font-display text-base font-semibold text-text-primary">Reference photos</h3>
        <p className="mt-0.5 text-[13px] text-text-faint">
          Example posts, logos, or product shots. These are automatically used to guide the look of
          every image generated for this account. Mark one as the <strong>logo</strong> and it is
          always placed on generated images, unaltered.
        </p>

        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {references.map((reference) => (
            <div key={reference.id} className="relative">
              {reference.thumbUrl ? (
                <Image
                  src={reference.thumbUrl}
                  alt={reference.name}
                  width={120}
                  height={120}
                  unoptimized
                  className={`aspect-square w-full rounded-xl border object-cover ${
                    reference.isLogo ? "border-primary" : "border-border-subtle"
                  }`}
                />
              ) : (
                <span className="flex aspect-square w-full items-center justify-center rounded-xl border border-border-subtle bg-bg-base text-[11px] text-text-faint">
                  {reference.name}
                </span>
              )}
              {reference.isLogo ? (
                <span className="absolute left-1 top-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-text-primary">
                  Logo
                </span>
              ) : null}
              {canManage ? (
                <form action={removeAccountReference} className="absolute right-1 top-1">
                  <input type="hidden" name="referenceId" value={reference.id} />
                  <input type="hidden" name="accountSlug" value={slug} />
                  <SubmitText
                    spinner
                    aria-label={`Remove ${reference.name}`}
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-nav/80 text-[13px] text-text-secondary hover:text-danger"
                  >
                    ×
                  </SubmitText>
                </form>
              ) : null}
              {canManage ? (
                <form action={setAccountLogo} className="absolute inset-x-1 bottom-1">
                  <input type="hidden" name="referenceId" value={reference.id} />
                  <input type="hidden" name="accountSlug" value={slug} />
                  <input type="hidden" name="makeLogo" value={reference.isLogo ? "false" : "true"} />
                  <SubmitText
                    spinner
                    className={`w-full rounded-full px-1 py-0.5 text-center text-[10px] font-medium ${
                      reference.isLogo
                        ? "bg-primary/20 text-primary-soft hover:text-primary-bright"
                        : "bg-bg-nav/80 text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {reference.isLogo ? "Unset logo" : "Set as logo"}
                  </SubmitText>
                </form>
              ) : null}
            </div>
          ))}
        </div>
        {references.length === 0 ? (
          <p className="mt-2 text-sm text-text-faint">No reference photos yet.</p>
        ) : null}

        {canManage ? <AddReferenceForm slug={slug} /> : null}
      </section>

      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <h3 className="font-display text-base font-semibold text-text-primary">Outro clip</h3>
        <p className="mt-0.5 text-[13px] text-text-faint">
          A short ending clip (mp4, vertical 9:16 works best) that can be appended to the end of this
          account&rsquo;s avatar videos. In the Approval Queue, click &ldquo;Add outro&rdquo; on a
          video to append it before posting.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-[13px] font-medium ${
              hasOutro
                ? "bg-success/15 text-success"
                : "border border-border-subtle text-text-faint"
            }`}
          >
            {hasOutro ? "Outro set" : "No outro yet"}
          </span>
          {canManage && hasOutro ? (
            <form action={removeAccountOutro}>
              <input type="hidden" name="accountSlug" value={slug} />
              <button
                type="submit"
                className="text-[13px] text-text-faint transition-colors hover:text-danger"
              >
                Remove outro
              </button>
            </form>
          ) : null}
        </div>
        {canManage ? <AddOutroForm slug={slug} hasOutro={hasOutro} /> : null}
      </section>

      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <h3 className="font-display text-base font-semibold text-text-primary">
          People who can appear in posts
        </h3>
        <p className="mt-0.5 text-[13px] text-text-faint">
          Photos of real people (for example owners) who can be placed into generated images. When
          you create a post, pick them in the composer under &ldquo;Avatar references&rdquo; and the
          AI depicts them accurately. Upload several photos per person, under one name, so the AI can
          use the angle that fits. People belong to this account.
        </p>

        {Object.keys(peopleByName).length === 0 ? (
          <p className="mt-3 text-sm text-text-faint">No people added yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {Object.entries(peopleByName).map(([personName, photos]) => (
              <div key={personName}>
                <span className="type-utility text-text-secondary">
                  {personName} · {photos.length} photo{photos.length === 1 ? "" : "s"}
                </span>
                <div className="mt-1.5 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6">
                  {photos.map((photo) => (
                    <div key={photo.id} className="group relative">
                      {photo.thumbUrl ? (
                        <Image
                          src={photo.thumbUrl}
                          alt={personName}
                          width={96}
                          height={96}
                          unoptimized
                          className="aspect-square w-full rounded-lg border border-border-subtle object-cover"
                        />
                      ) : (
                        <span className="flex aspect-square w-full items-center justify-center rounded-lg border border-border-subtle bg-bg-base text-[11px] text-text-faint">
                          {personName}
                        </span>
                      )}
                      {isAdmin ? (
                        <form action={removePersonReference} className="absolute right-1 top-1">
                          <input type="hidden" name="referenceId" value={photo.id} />
                          <input type="hidden" name="accountSlug" value={slug} />
                          <SubmitText
                            spinner
                            aria-label={`Remove photo of ${personName}`}
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-nav/80 text-[13px] text-text-secondary opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                          >
                            ×
                          </SubmitText>
                        </form>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {isAdmin ? (
          <AddPersonForm slug={slug} />
        ) : (
          <p className="mt-3 text-[13px] text-text-faint">
            Only admins can add people (real likenesses).
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Collapses a numbered photo label to the person's base name, e.g.
 * "Alex Image 3" / "Alex Photo 8" / "Alex 2" → "Alex". Names with
 * no trailing number are returned unchanged.
 */
function personDisplayName(name: string): string {
  const base = name.replace(/[\s_-]*(image|photo|pic|picture)?[\s_-]*\d+$/i, "").trim();
  return base.length > 0 ? base : name;
}

function AddPersonForm({ slug }: { slug: string }) {
  const [state, action, isPending] = useActionState(uploadPersonReference, initialState);

  return (
    <form action={action} className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-3">
      <span className="type-utility text-text-faint">Add person photos</span>
      <input type="hidden" name="accountSlug" value={slug} />
      <input name="personName" required placeholder="Person's name (e.g. Alex)" className={inputClass} />
      <input
        type="file"
        name="file"
        required
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="text-[13px] text-text-secondary file:mr-2 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:font-display file:text-[13px] file:text-text-primary"
      />
      <span className="text-[11px] text-text-faint">
        Select several photos at once — more angles help the AI depict them accurately.
      </span>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="secondary" isLoading={isPending} className="self-start">
        Upload photos
      </Button>
    </form>
  );
}

function AddOutroForm({ slug, hasOutro }: { slug: string; hasOutro: boolean }) {
  const [state, action, isPending] = useActionState(uploadAccountOutro, initialState);

  return (
    <form action={action} className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-3">
      <span className="type-utility text-text-faint">
        {hasOutro ? "Replace outro clip" : "Upload outro clip"}
      </span>
      <input type="hidden" name="accountSlug" value={slug} />
      <input
        type="file"
        name="file"
        required
        accept="video/mp4,video/quicktime,video/webm"
        className="text-[13px] text-text-secondary file:mr-2 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:font-display file:text-[13px] file:text-text-primary"
      />
      <span className="text-[11px] text-text-faint">mp4 / mov / webm, up to 50 MB. Vertical 9:16 recommended.</span>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-success">Outro saved.</p> : null}
      <Button type="submit" variant="secondary" isLoading={isPending} className="self-start">
        {hasOutro ? "Replace outro" : "Upload outro"}
      </Button>
    </form>
  );
}

function AddReferenceForm({ slug }: { slug: string }) {
  const [state, action, isPending] = useActionState(uploadAccountReference, initialState);

  return (
    <form action={action} className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-3">
      <span className="type-utility text-text-faint">Add reference photos</span>
      <input type="hidden" name="accountSlug" value={slug} />
      <input name="name" required placeholder="Label (e.g. Feed example, Logo)" className={inputClass} />
      <input
        type="file"
        name="file"
        required
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="text-[13px] text-text-secondary file:mr-2 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:font-display file:text-[13px] file:text-text-primary"
      />
      <span className="text-[11px] text-text-faint">
        Select several at once. When you add multiple, they&rsquo;re numbered (e.g. &ldquo;Feed
        example 1&rdquo;).
      </span>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="secondary" isLoading={isPending} className="self-start">
        Upload
      </Button>
    </form>
  );
}
