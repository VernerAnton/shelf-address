import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon } from "@/components/icons";
import {
  getLocation,
  getPath,
  hasShelfBelow,
  listChildren,
  whyCannotPlace,
} from "@/lib/locations";
import { Breadcrumb } from "../../_components/breadcrumb";
import { KIND_LABEL, KindIcon } from "../../_components/kind";
import { MoveForm } from "../../_components/move-form";

export const dynamic = "force-dynamic";

/** `?at=` value meaning the top level (an absent `at` means "where it is now"). */
const TOP = "top";

/**
 * A drill-down picker for where to move a location. Browsing works like the
 * tree itself; places it can't go are shown but not enterable, with the reason.
 */
export default async function MovePage(props: PageProps<"/sections/[id]/move">) {
  const { id } = await props.params;
  const { at } = await props.searchParams;

  const item = await getLocation(id);
  if (!item) notFound();
  const itemHref = `/sections/${id}`;

  if (item.kind === "site") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sites don&apos;t move</h1>
        <p className="text-muted">A site is always at the top level.</p>
        <Link href={itemHref} className="text-accent hover:underline">Back to {item.label}</Link>
      </main>
    );
  }

  const atId = at === TOP ? null : typeof at === "string" && at ? at : item.parentId;
  const atPath = atId ? await getPath(atId) : [];
  if (atId && atPath.length === 0) notFound();

  const [children, shelfBelow] = await Promise.all([listChildren(atId), hasShelfBelow(id)]);
  const here = atPath.at(-1);
  const hereName = here ? `“${here.label}”` : "the top level";
  const blockedHere =
    item.parentId === atId ? "It's already here." : whyCannotPlace(item, shelfBelow, atPath);

  const moveHref = (target: string | null) => `/sections/${id}/move?at=${target ?? TOP}`;
  const crumbs = [
    { href: moveHref(null), label: "Top level" },
    ...atPath.slice(0, -1).map((l) => ({ href: moveHref(l.id), label: l.label })),
  ];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-6 pb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight break-words">Move “{item.label}”</h1>
        <p className="mt-1 text-sm text-muted">
          Go to where it should live. Everything inside it, and any books logged
          there, move with it.
        </p>
      </div>

      <Breadcrumb crumbs={atPath.length ? crumbs : []} current={here?.label ?? "Top level"} />

      {children.filter((c) => c.id !== id).length > 0 ? (
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {children
            .filter((child) => child.id !== id)
            .map((child) => {
              const reason = whyCannotPlace(item, shelfBelow, [...atPath, child]);
              const body = (
                <>
                  <KindIcon kind={child.kind} className="size-5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{child.label}</span>
                    <span className="block truncate text-sm text-muted">
                      {reason ?? KIND_LABEL[child.kind]}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={child.id} className="border-b border-line last:border-0">
                  {reason ? (
                    <div className="flex min-h-14 items-center gap-3 px-4 py-3 opacity-50">{body}</div>
                  ) : (
                    <Link
                      href={moveHref(child.id)}
                      className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-line/50"
                    >
                      {body}
                      <ChevronRightIcon className="size-5 shrink-0 text-muted" />
                    </Link>
                  )}
                </li>
              );
            })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          Nothing else inside {hereName}.
        </p>
      )}

      <MoveForm
        id={id}
        targetId={atId}
        targetName={here?.label ?? "top level"}
        blocked={blockedHere}
        cancelHref={itemHref}
      />
    </main>
  );
}
