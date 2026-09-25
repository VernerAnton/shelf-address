import Link from "next/link";
import { notFound } from "next/navigation";
import { displayAddress } from "@/lib/address";
import { getCopy } from "@/lib/copies";
import { formatIsbn } from "@/lib/isbn";
import { getPath, nearestAddressed, siteOf } from "@/lib/locations";
import { Breadcrumb } from "@/app/sections/_components/breadcrumb";
import { ConditionForm, DeleteCopy } from "../copy-forms";

export const dynamic = "force-dynamic";

/** One physical copy: where it is, its condition, move or remove it. */
export default async function CopyPage(props: PageProps<"/copies/[id]">) {
  const { id } = await props.params;
  const copy = await getCopy(id);
  if (!copy) notFound();

  const path = await getPath(copy.locationId);
  const place = path.at(-1);
  const site = siteOf(path);
  const addressed = nearestAddressed(path);
  const crumbs = [
    { href: "/sections", label: "Sections" },
    ...path.map((l) => ({ href: `/sections/${l.id}`, label: l.label })),
  ];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-4 pb-6">
      <Breadcrumb crumbs={crumbs} current="Book" />
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Book</p>
        <h1 className="text-2xl font-semibold tracking-tight break-words">
          {copy.title ?? <span className="font-mono">{formatIsbn(copy.isbn13)}</span>}
        </h1>
        {copy.title && <p className="font-mono text-sm text-muted">{formatIsbn(copy.isbn13)}</p>}
        {!copy.title && <p className="text-sm text-muted">Title lookup is coming soon.</p>}
      </header>

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
