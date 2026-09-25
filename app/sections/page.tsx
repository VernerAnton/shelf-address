import Link from "next/link";
import { listChildren } from "@/lib/locations";
import { AddButton } from "./_components/add-button";
import { ListHeader } from "./_components/list-header";
import { LocationList } from "./_components/location-list";
import { ViewSwitch } from "./_components/view-switch";

export const dynamic = "force-dynamic";

export default async function SectionsPage() {
  const roots = await listChildren(null);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-6 pb-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sections</h1>
      <ViewSwitch active="tree" />

      {roots.length > 0 ? (
        <>
          <ListHeader count={roots.length} orderHref="/sections/order" />
          <LocationList locations={roots} />
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-line p-6 text-center text-muted">
          <p className="font-medium text-foreground">Nothing here yet</p>
          <p className="mt-1 text-sm">
            Start by adding the store and each warehouse as a site. Shelves and
            sections go inside them.
          </p>
        </div>
      )}

      <AddButton href="/sections/new" label={roots.length > 0 ? "Add a site" : "Add your first site"} />

      <Link href="/status" className="mt-auto pt-4 text-center text-xs text-muted hover:underline">
        System status
      </Link>
    </main>
  );
}
