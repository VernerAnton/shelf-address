import Link from "next/link";
import { notFound } from "next/navigation";
import { allowedChildKinds, getPath, listChildren, type LocationKind } from "@/lib/locations";
import { updateLocationAction } from "../../actions";
import { Breadcrumb } from "../../_components/breadcrumb";
import { DeleteLocation } from "../../_components/delete-location";
import { LocationForm } from "../../_components/location-form";

export const dynamic = "force-dynamic";

export default async function EditLocationPage(props: PageProps<"/sections/[id]/edit">) {
  const { id } = await props.params;
  const path = await getPath(id);
  const location = path.at(-1);
  if (!location) notFound();

  const [children, siblings] = await Promise.all([
    listChildren(id),
    listChildren(location.parentId),
  ]);
  const counts = siblings.find((s) => s.id === id);

  // A site stays a site. Shelves and sections can swap, within the same rules
  // as adding one at this spot.
  const kinds: LocationKind[] =
    location.kind === "site"
      ? ["site"]
      : allowedChildKinds(path.slice(0, -1)).filter((k) => k !== "site");

  const crumbs = [
    { href: "/sections", label: "Sections" },
    ...path.map((l) => ({ href: `/sections/${l.id}`, label: l.label })),
  ];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-4 pb-6">
      <Breadcrumb crumbs={crumbs} current="Edit" />
      <h1 className="text-2xl font-semibold tracking-tight">Edit</h1>
      <LocationForm
        action={updateLocationAction}
        hidden={{ id }}
        kinds={kinds}
        initial={{
          label: location.label,
          kind: location.kind,
          address: location.address ?? "",
        }}
        submitLabel="Save"
        cancelHref={`/sections/${id}`}
      />

      {location.kind !== "site" && (
        <Link
          href={`/sections/${id}/move`}
          className="flex h-12 items-center justify-center rounded-xl border border-line bg-surface font-medium"
        >
          Move to another place
        </Link>
      )}

      <section className="mt-6 border-t border-line pt-6">
        <DeleteLocation
          id={id}
          label={location.label}
          childCount={children.length}
          copyCount={counts?.copyCount ?? 0}
        />
      </section>
    </main>
  );
}
