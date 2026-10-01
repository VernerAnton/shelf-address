import { EvaluateScreen } from "./evaluate-screen";

// Static, like Scan: the screen is all on the phone.
export default function EvaluatePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-6 pb-6">
      <h1 className="text-2xl font-semibold tracking-tight">Evaluate</h1>
      <EvaluateScreen />
    </main>
  );
}
