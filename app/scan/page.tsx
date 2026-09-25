import { ScanScreen } from "./_components/scan-screen";

// Static on purpose: everything on this screen comes from the phone's own
// storage, so the service worker can serve it with no signal at all.
export default function ScanPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-6 pb-6">
      <h1 className="text-2xl font-semibold tracking-tight">Scan</h1>
      <ScanScreen />
    </main>
  );
}
