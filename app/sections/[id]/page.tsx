import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "@/components/icons";
import { displayAddress } from "@/lib/address";
import {
  allowedChildKinds,
  canHavePanel,
  getPath,
  listChildren,
  nearestAddressed,
  siteOf,
} from "@/lib/locations";
import { getSiteMap } from "@/lib/maps";
import { getPanel, guidanceFor, panelEntries } from "@/lib/panels";
import { MapLink } from "../_components/map-link";
import { GuidanceCard, InstructionsCard } from "../_components/instructions";
import { listCopiesAt } from "@/lib/copies";
import { AddButton } from "../_components/add-button";
import { BooksHere } from "../_components/books-here";
import { ScanHereButton } from "../_components/scan-here-button";
import { Breadcrumb } from "../_components/breadcrumb";
import { KIND_LABEL, KindIcon } from "../_components/kind";
import { ListHeader } from "../_components/list-header";
import { LocationList } from "../_components/location-list";

export const dynamic = "force-dynamic";

export default async function LocationPage(props: PageProps<"/sections/[id]">) {
  const { id } = await props.params;
  const path = await getPath(id);
  const location = path.at(-1);
  if (!location) notFound();

  const ownsPanel = canHavePanel(location);
  const site = siteOf(path);
  const [children, copies, ownPanel, entries, guidance, mapSrc] = await Promise.all([
    listChildren(id),
    listCopiesAt(id),
    ownsPanel ? getPanel(id) : null,
    ownsPanel ? panelEntries(id) : [],
    ownsPanel ? null : guidanceFor(path),
    site ? getSiteMap(site.id) : null,
  ]);
  // Notes for the places listed below come from whichever panel covers them.
  const notes = ownPanel?.notes ?? guidance?.panel.notes ?? {};
  // No address of its own: say which addressed place it's inside, since
  // that's the answer a book logged here will give.
  const inside = location.address ? null : nearestAddressed(path.slice(0, -1));
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
          {location.address ? (
            <p className="mt-1 text-lg font-semibold text-accent">
              {displayAddress(location.address, site?.label ?? null)}
            </p>
          ) : location.kind === "shelf" ? (
            <p className="mt-1 text-sm text-danger">
              No address — this shelf lost it to another place. Edit to give it a new one.
            </p>
          ) : null}
          {inside?.address && (
            <p className="mt-1 text-sm text-muted">
              Inside{" "}
              <span className="font-semibold text-foreground">
                {displayAddress(inside.address, site?.label ?? null)}
              </span>
            </p>
          )}
        </div>
        <Link
          href={`/sections/${id}/edit`}
          aria-label={`Edit ${location.label}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted"
        >
          <PencilIcon className="size-5" />
        </Link>
      </header>

      {site && <MapLink site={site} hasMap={Boolean(mapSrc)} own={site.id === id} />}
      {ownsPanel && <InstructionsCard owner={location} panel={ownPanel} entries={entries} />}
      {guidance && <GuidanceCard guidance={guidance} />}

      {children.length > 0 ? (
        <>
          <ListHeader count={children.length} orderHref={`/sections/order?parent=${id}`} />
          <LocationList locations={children} notes={notes} />
        </>
      ) : copies.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          Nothing inside yet.
        </p>
      ) : null}

      {canAdd && <AddButton href={`/sections/new?parent=${id}`} label="Add inside" />}

      {location.kind !== "site" && (
        <>
          <ScanHereButton id={id} />
          <BooksHere copies={copies} />
        </>
      )}
    </main>
  );
}
