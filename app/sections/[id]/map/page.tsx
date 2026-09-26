import { notFound } from "next/navigation";
import { getPath } from "@/lib/locations";
import { getSiteMap } from "@/lib/maps";
import { Breadcrumb } from "../../_components/breadcrumb";
import { MapUpload } from "./map-upload";
import { MapView } from "./map-view";

export const dynamic = "force-dynamic";

/** A site's reference map (§5): a photo of a sketch, purely a memory aid. */
export default async function SiteMapPage(props: PageProps<"/sections/[id]/map">) {
  const { id } = await props.params;
  const path = await getPath(id);
  const site = path.at(-1);
  if (!site || site.kind !== "site") notFound();
  const src = await getSiteMap(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-4 pb-6">
      <Breadcrumb crumbs={[{ href: "/sections", label: "Sections" }, { href: `/sections/${id}`, label: site.label }]} current="Map" />
      <h1 className="text-2xl font-semibold tracking-tight">Map of {site.label}</h1>
      {src ? (
        <>
          <MapView src={src} alt={`Map of ${site.label}`} />
          <p className="-mt-3 text-sm text-muted">Tap the map to see it full size.</p>
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          No map yet. A phone photo of a sketch on paper is enough — it&apos;s only there to help
          you remember the layout.
        </p>
      )}
      <MapUpload siteId={id} hasMap={Boolean(src)} />
    </main>
  );
}
