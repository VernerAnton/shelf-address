import { ExtractScreen } from "./extract-screen";

// Static, like Evaluate: the screen is all on the phone.
export default function ExtractPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-6 pb-6">
      <h1 className="text-2xl font-semibold tracking-tight">Extract</h1>
      <ExtractScreen />
    </main>
  );
}
