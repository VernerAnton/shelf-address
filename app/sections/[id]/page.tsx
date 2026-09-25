import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "@/components/icons";
import { displayAddress } from "@/lib/address";
import { allowedChildKinds, getPath, listChildren, siteOf } from "@/lib/locations";
import { AddButton } from "../_components/add-button";
import { Breadcrumb } from "../_components/breadcrumb";
import { KIND_LABEL, KindIcon } from "../_components/kind";
import { LocationList } from "../_components/location-list";

export const dynamic = "force-dynamic";

export default async function LocationPage(props: PageProps<"/sections/[id]">) {
  const { id } = await props.params;
  const path = await getPath(id);
  const location = path.at(-1);
  if (!location) notFound();

  const children = await listChildren(id);
  const site = siteOf(path);
  const canAdd = allowedChildKinds(path).length > 0;

  const crumbs = [
    { href: "/sections", label: "Sections" },
    ...path.slice(0, -1).map((l) => ({ href: `/sections/${l.id}`, label: l.label })),
  ];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-4 pb-6">
      <Breadcrumb crumbs={crumbs} current={location.label} />

      <header className="flex items-start gap-3">
        <KindIcon kind={location.kind} className="mt-1 size-6 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            {KIND_LABEL[location.kind]}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight break-words">{location.label}</h1>
          {location.kind === "shelf" &&
            (location.address ? (
              <p className="mt-1 text-lg font-semibold text-accent">
                {displayAddress(location.address, site?.label ?? null)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-danger">
                No address — this shelf lost it to another one. Edit to give it a new one.
              </p>
            ))}
        </div>
        <Link
          href={`/sections/${id}/edit`}
          aria-label={`Edit ${location.label}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted"
        >
          <PencilIcon className="size-5" />
        </Link>
      </header>

      {children.length > 0 ? (
        <LocationList locations={children} />
      ) : (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          Nothing inside yet.
        </p>
      )}

      {canAdd && <AddButton href={`/sections/new?parent=${id}`} label="Add inside" />}
    </main>
  );
}
