import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isPhone } from "@/lib/device";
import { ExtractScreen } from "./extract-screen";

// The screen is all on the phone. On a computer the Extract tab goes straight
// to Saved texts (docs/spec-corrections.md §25): there's nothing to photograph there.
export default async function ExtractPage() {
  if (!isPhone((await headers()).get("user-agent"))) redirect("/extract/saved");
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-6 pb-6">
      <h1 className="text-2xl font-semibold tracking-tight">Extract</h1>
      <ExtractScreen />
    </main>
  );
}
