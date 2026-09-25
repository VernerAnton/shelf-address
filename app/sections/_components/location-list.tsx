import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import type { LocationWithCounts } from "@/lib/locations";
import { KIND_LABEL, KindIcon } from "./kind";

function summary(location: LocationWithCounts): string {
  const parts: string[] = [];
  if (location.kind === "shelf" && !location.address) parts.push("No address yet");
  if (location.childCount > 0) {
    parts.push(`${location.childCount} inside`);
  }
  if (location.copyCount > 0) {
    parts.push(`${location.copyCount} ${location.copyCount === 1 ? "book" : "books"}`);
  }
  return parts.join(" · ");
}

export function LocationList({ locations }: { locations: LocationWithCounts[] }) {
  return (
    <ul className="overflow-hidden rounded-xl border border-line bg-surface">
      {locations.map((location) => {
        const detail = summary(location);
        return (
          <li key={location.id} className="border-b border-line last:border-0">
            <Link
              href={`/sections/${location.id}`}
              className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-line/50"
            >
              <KindIcon
                kind={location.kind}
                className="size-5 shrink-0 text-muted"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-medium">{location.label}</span>
                  {location.address && (
                    <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-xs font-semibold text-accent">
                      {location.address}
                    </span>
                  )}
                </span>
                <span className="block truncate text-sm text-muted">
                  {KIND_LABEL[location.kind]}
                  {detail && ` · ${detail}`}
                </span>
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-muted" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
