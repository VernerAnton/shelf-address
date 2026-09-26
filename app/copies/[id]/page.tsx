import Link from "next/link";
import { notFound } from "next/navigation";
import { BookCover } from "@/components/book-cover";
import { displayAddress } from "@/lib/address";
import { countSameBarcode, getCopy } from "@/lib/copies";
import { editionKind, keyLabel } from "@/lib/edition-key";
import { kickLookups } from "@/lib/editions";
import { getPath, nearestAddressed, siteOf } from "@/lib/locations";
import { Breadcrumb } from "@/app/sections/_components/breadcrumb";
import { markReviewedAction, retryLookupAction } from "../actions";
import { ConditionForm, DeleteCopy, EditDetails } from "../copy-forms";
import { WrongBook } from "../wrong-book";

export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = {
  finna: "Finna",
  google_books: "Google Books",
  open_library: "Open Library",
  manual: "typed in by hand",
};

/** One physical copy: what it is, where it is, its condition; move or remove it. */
export default async function CopyPage(props: PageProps<"/copies/[id]">) {
  const { id } = await props.params;
  const copy = await getCopy(id);
  if (!copy) notFound();
  const { edition } = copy;
  if (edition.lookupStatus === "pending") await kickLookups(edition.key);

  const [path, sameBarcode] = await Promise.all([getPath(copy.locationId), countSameBarcode(copy.id)]);
  const place = path.at(-1);
  const site = siteOf(path);
  const addressed = nearestAddressed(path);
  const crumbs = [
    { href: "/sections", label: "Sections" },
    ...path.map((l) => ({ href: `/sections/${l.id}`, label: l.label })),
  ];
  const facts = [edition.author, edition.publisher, edition.year].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-4 pb-6">
      <Breadcrumb crumbs={crumbs} current="Book" />

      <header className="flex gap-4">
        <BookCover src={edition.coverUrl} size="md" alt={edition.title ? `Cover of ${edition.title}` : ""} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight break-words">
            {edition.title ?? <span className="font-mono">{keyLabel(edition.key)}</span>}
          </h1>
          {facts && <p className="mt-0.5 text-sm">{facts}</p>}
          <p className="mt-1 font-mono text-xs text-muted">{keyLabel(edition.key)}</p>
          {edition.source && edition.title && (
            <p className="text-xs text-muted">Details from {SOURCE[edition.source] ?? edition.source}</p>
          )}
          {edition.needsReview && (
            <p className="mt-2 inline-block rounded bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn-text">
              Needs review
            </p>
          )}
        </div>
      </header>

      {edition.lookupStatus === "pending" && (
        <form action={retryLookupAction} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 text-sm">
          <input type="hidden" name="key" value={edition.key} />
          <span className="text-muted">Looking up title and cover…</span>
          <button type="submit" className="h-9 shrink-0 rounded-lg border border-line px-3 font-medium">
            Look up now
          </button>
        </form>
      )}
      {edition.lookupStatus === "not_found" && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 text-sm">
          <p className="text-muted">Not found in Finna, Google Books or Open Library.</p>
          <form action={retryLookupAction}>
            <input type="hidden" name="key" value={edition.key} />
            <button type="submit" className="h-9 rounded-lg border border-line px-3 font-medium">
              Try again
            </button>
          </form>
        </div>
      )}

      {edition.lookupStatus !== "pending" && (
        <EditDetails
          label={edition.title ? "Edit details" : "Enter details by hand"}
          editionKey={edition.key}
          title={edition.title}
          author={edition.author}
          year={edition.year}
          needsReview={edition.needsReview || !edition.title}
        />
      )}
      {edition.needsReview && edition.title && (
        <form action={markReviewedAction}>
          <input type="hidden" name="key" value={edition.key} />
          <button type="submit" className="h-12 w-full rounded-xl border border-line bg-surface font-medium">
            Mark as reviewed
          </button>
        </form>
      )}

      {editionKind(edition.key) === "isbn" && (
        <WrongBook copyId={copy.id} currentTitle={edition.title ?? keyLabel(edition.key)} sameBarcode={sameBarcode} />
      )}

      <section className="rounded-xl border border-line bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Where it is</p>
        <p className="mt-1 font-semibold">{place?.label}</p>
        {addressed?.address && (
          <p className="text-accent">{displayAddress(addressed.address, site?.label ?? null)}</p>
        )}
        <p className="mt-1 text-sm text-muted">
          Logged {new Date(copy.addedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </section>

      <ConditionForm id={copy.id} condition={copy.condition} />

      <Link
        href={`/copies/${copy.id}/move`}
        className="flex h-12 items-center justify-center rounded-xl border border-line bg-surface font-medium"
      >
        Move to another place
      </Link>

      <section className="mt-4 border-t border-line pt-6">
        <DeleteCopy id={copy.id} />
      </section>
    </main>
  );
}
