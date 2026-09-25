import Link from "next/link";

/** Count above a list of children, with a way into the reorder screen. */
export function ListHeader({ count, orderHref }: { count: number; orderHref: string }) {
  return (
    <div className="-mb-2 flex items-center justify-between px-1 text-sm">
      <span className="text-muted">
        {count} {count === 1 ? "place" : "places"}
      </span>
      {count > 1 && (
        <Link href={orderHref} className="py-1 font-medium text-accent hover:underline">
          Reorder
        </Link>
      )}
    </div>
  );
}
