import { notFound } from "next/navigation";
import { allowedChildKinds, getPath, type LocationKind } from "@/lib/locations";
import { createLocationAction } from "../actions";
import { Breadcrumb } from "../_components/breadcrumb";
import { LocationForm } from "../_components/location-form";

export const dynamic = "force-dynamic";

export default async function NewLocationPage(props: PageProps<"/sections/new">) {
  const { parent } = await props.searchParams;
  const parentId = typeof parent === "string" && parent ? parent : null;

  const path = parentId ? await getPath(parentId) : [];
  if (parentId && path.length === 0) notFound();

  const kinds = allowedChildKinds(path);
  // At the top level the first thing to add is a site; inside, most entries
  // are sections, so that's the default there.
  const defaultKind: LocationKind = kinds.includes("site") ? "site" : "node";

  const crumbs = [
    { href: "/sections", label: "Sections" },
    ...path.map((l) => ({ href: `/sections/${l.id}`, label: l.label })),
  ];
  const parentHref = parentId ? `/sections/${parentId}` : "/sections";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-4 pb-6">
      <Breadcrumb crumbs={crumbs} current="New" />
      <h1 className="text-2xl font-semibold tracking-tight">
        {path.length > 0 ? `Add inside ${path.at(-1)!.label}` : "Add a site"}
      </h1>
      <LocationForm
        action={createLocationAction}
        hidden={parentId ? { parentId } : {}}
        kinds={kinds}
        initial={{ label: "", kind: defaultKind, address: "" }}
        submitLabel="Add"
        cancelHref={parentHref}
      />
    </main>
  );
}
