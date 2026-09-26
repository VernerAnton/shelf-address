import Link from "next/link";
import { MapIcon } from "@/components/icons";
import type { Location } from "@/lib/location-model";

/**
 * A link to a site's reference map. On the site's own page it's always shown
 * (to add one); elsewhere only when the site has a map.
 */
export function MapLink({ site, hasMap, own = false }: { site: Location; hasMap: boolean; own?: boolean }) {
  if (!hasMap && !own) return null;
  return (
    <Link
      href={`/sections/${site.id}/map`}
      className="flex h-12 items-center gap-3 rounded-xl border border-line bg-surface px-4 font-medium"
    >
      <MapIcon className="size-5 text-muted" />
      {own ? (hasMap ? "Map" : "Add a map") : `Map of ${site.label}`}
    </Link>
  );
}
