import { NodeIcon, ShelfIcon, SiteIcon } from "@/components/icons";
import type { LocationKind } from "@/lib/location-model";

// `node` is shown as "Section": the bottom-nav tab is Sections, and §3's
// worked examples ("Section 1", "Sub-sec 1") are the everyday word for it.
export const KIND_LABEL: Record<LocationKind, string> = {
  site: "Site",
  shelf: "Shelf",
  node: "Section",
};

export const KIND_HINT: Record<LocationKind, string> = {
  site: "The store, or a warehouse.",
  shelf: "A shelf or wall unit. Gets its own address.",
  node: "Anything in between — a room, row, table, box. Can have its own address.",
};

const ICONS = { site: SiteIcon, shelf: ShelfIcon, node: NodeIcon } as const;

export function KindIcon({ kind, className }: { kind: LocationKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon className={className} />;
}
