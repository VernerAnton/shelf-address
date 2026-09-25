import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon } from "@/components/icons";
import { getPath, listChildren } from "@/lib/locations";
import { resetOrderAction, shiftLocationAction } from "../actions";
import { Breadcrumb } from "../_components/breadcrumb";
import { KindIcon } from "../_components/kind";

export const dynamic = "force-dynamic";

function ShiftButton({
  id,
  direction,
  disabled,
  label,
}: {
  id: string;
  direction: "up" | "down";
  disabled: boolean;
  label: string;
}) {
  const Icon = direction === "up" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <form action={shiftLocationAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled}
        aria-label={`Move ${label} ${direction}`}
        className="flex size-11 items-center justify-center rounded-lg border border-line text-foreground disabled:opacity-25"
      >
        <Icon className="size-5" />
      </button>
    </form>
  );
}

/** Custom order for one level of the tree, with up/down buttons. */
export default async function OrderPage(props: PageProps<"/sections/order">) {
  const { parent } = await props.searchParams;
  const parentId = typeof parent === "string" && parent ? parent : null;

  const path = parentId ? await getPath(parentId) : [];
  if (parentId && path.length === 0) notFound();
  const children = await listChildren(parentId);

  const backHref = parentId ? `/sections/${parentId}` : "/sections";
  const crumbs = [
    { href: "/sections", label: "Sections" },
    ...path.map((l) => ({ href: `/sections/${l.id}`, label: l.label })),
  ];
  const customised = children.some((c) => c.sortOrder > 0);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-4 pb-6">
      <Breadcrumb crumbs={crumbs} current="Order" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Order {path.length ? `inside ${path.at(-1)!.label}` : "top level"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {customised
            ? "Custom order. New entries go to the end."
            : "Currently A–Z (Section 2 before Section 10). Moving anything switches this level to a custom order."}
        </p>
      </div>

      <ul className="overflow-hidden rounded-xl border border-line bg-surface">
        {children.map((child, i) => (
          <li
            key={child.id}
            className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 last:border-0"
          >
            <KindIcon kind={child.kind} className="size-5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate font-medium">{child.label}</span>
            <ShiftButton id={child.id} direction="up" disabled={i === 0} label={child.label} />
            <ShiftButton
              id={child.id}
              direction="down"
              disabled={i === children.length - 1}
              label={child.label}
            />
          </li>
        ))}
      </ul>

      <Link
        href={backHref}
        className="flex h-12 items-center justify-center rounded-xl bg-accent font-medium text-accent-contrast"
      >
        Done
      </Link>

      {customised && (
        <form action={resetOrderAction} className="flex justify-center">
          <input type="hidden" name="parentId" value={parentId ?? ""} />
          <button type="submit" className="text-sm text-accent hover:underline">
            Reset to A–Z order
          </button>
        </form>
      )}
    </main>
  );
}
