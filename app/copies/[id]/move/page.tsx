import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon } from "@/components/icons";
import { getCopy } from "@/lib/copies";
import { keyLabel } from "@/lib/edition-key";
import { getPath, listChildren } from "@/lib/locations";
import { Breadcrumb } from "@/app/sections/_components/breadcrumb";
import { KIND_LABEL, KindIcon } from "@/app/sections/_components/kind";
import { MoveForm } from "@/app/sections/_components/move-form";
import { moveCopyAction } from "../../actions";

export const dynamic = "force-dynamic";

const TOP = "top";

/** Drill-down picker for moving one book. Any shelf or section; never a site. */
export default async function MoveCopyPage(props: PageProps<"/copies/[id]/move">) {
  const { id } = await props.params;
  const { at } = await props.searchParams;
  const copy = await getCopy(id);
  if (!copy) notFound();

  const atId = at === TOP ? null : typeof at === "string" && at ? at : copy.locationId;
  const atPath = atId ? await getPath(atId) : [];
  if (atId && atPath.length === 0) notFound();
  const here = atPath.at(-1);
  const children = await listChildren(atId);

  const blocked = !here
    ? "Choose a shelf or section."
    : here.kind === "site"
      ? "Books can't be logged directly at a site — go into a shelf or section."
      : here.id === copy.locationId
        ? "It's already here."
        : null;

  const moveHref = (target: string | null) => `/copies/${id}/move?at=${target ?? TOP}`;
  const crumbs = [
    { href: moveHref(null), label: "Top level" },
    ...atPath.slice(0, -1).map((l) => ({ href: moveHref(l.id), label: l.label })),
  ];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-6 pb-6">
      <h1 className="text-2xl font-semibold tracking-tight break-words">
        Move {copy.edition.title ?? <span className="font-mono">{keyLabel(copy.isbn13)}</span>}
      </h1>
      <Breadcrumb crumbs={atPath.length ? crumbs : []} current={here?.label ?? "Top level"} />

      {children.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {children.map((child) => (
            <li key={child.id} className="border-b border-line last:border-0">
              <Link
                href={moveHref(child.id)}
                className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-line/50"
              >
                <KindIcon kind={child.kind} className="size-5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{child.label}</span>
                  <span className="block text-sm text-muted">{KIND_LABEL[child.kind]}</span>
                </span>
                <ChevronRightIcon className="size-5 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          Nothing inside here.
        </p>
      )}

      <MoveForm
        action={moveCopyAction}
        id={id}
        targetId={atId}
        targetName={here?.label ?? "top level"}
        blocked={blocked}
        cancelHref={`/copies/${id}`}
      />
    </main>
  );
}
