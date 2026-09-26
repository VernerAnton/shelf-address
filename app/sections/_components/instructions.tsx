import Link from "next/link";
import type { Location } from "@/lib/location-model";
import type { Guidance, Panel, PanelEntry } from "@/lib/panels";
import { PanelEditor } from "./panel-editor";

export function updatedLabel(iso: string) {
  return `Updated ${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** On a shelf's (or addressed section's) own page: its panel, with the pencil. */
export function InstructionsCard({
  owner,
  panel,
  entries,
}: {
  owner: Location;
  panel: Panel | null;
  entries: PanelEntry[];
}) {
  const editor = (
    <PanelEditor
      locationId={owner.id}
      label={owner.label}
      howToFind={panel?.howToFind ?? ""}
      notes={panel?.notes ?? {}}
      entries={entries.map((e) => ({ id: e.location.id, label: e.location.label, depth: e.depth }))}
      empty={!panel}
    />
  );
  if (!panel) {
    return (
      <section aria-label="Instructions" className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line p-4">
        <p className="text-sm text-muted">No instructions yet for finding books here.</p>
        {editor}
      </section>
    );
  }
  return (
    <section aria-label="Instructions" className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">How to find a book here</h2>
          <p className="text-xs text-muted">{updatedLabel(panel.updatedAt)}</p>
        </div>
        {editor}
      </div>
      {panel.howToFind ? (
        <p className="mt-2 whitespace-pre-line">{panel.howToFind}</p>
      ) : (
        <p className="mt-2 text-sm text-muted">Only notes for the parts inside so far — tap the pencil to add a worked example.</p>
      )}
    </section>
  );
}

/**
 * Inside a shelf (or addressed section): the instructions that apply here,
 * from the governing panel — its notes for each level on the way down, then
 * its "How to find a book here".
 */
export function GuidanceCard({ guidance, compact = false }: { guidance: Guidance; compact?: boolean }) {
  const { owner, panel, trail } = guidance;
  return (
    <section aria-label="Instructions" className={compact ? "flex flex-col gap-1.5" : "rounded-xl border border-line bg-surface p-4"}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">
        From the instructions for{" "}
        <Link href={`/sections/${owner.id}`} className="text-accent normal-case">
          {owner.address ?? owner.label}
        </Link>
      </p>
      {trail.map((t) => (
        <p key={t.location.id}>
          <span className="font-medium">{t.location.label}:</span> {t.note}
        </p>
      ))}
      {panel.howToFind && <p className="whitespace-pre-line text-sm">{panel.howToFind}</p>}
      <p className="text-xs text-muted">{updatedLabel(panel.updatedAt)}</p>
    </section>
  );
}
