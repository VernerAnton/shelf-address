import { listAddressedShelves } from "@/lib/locations";
import { AddressDirectory } from "../_components/address-directory";
import { ViewSwitch } from "../_components/view-switch";

export const dynamic = "force-dynamic";

export default async function AddressesPage() {
  const shelves = await listAddressedShelves();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-6 pb-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sections</h1>
      <ViewSwitch active="addresses" />
      {shelves.length > 0 ? (
        <AddressDirectory shelves={shelves} />
      ) : (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          No shelf addresses yet. Add a shelf from the Tree view and it will
          appear here.
        </p>
      )}
    </main>
  );
}
