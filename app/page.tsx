import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isPhone } from "@/lib/device";

// Phones open on Evaluate (docs/spec-corrections.md §20; the manifest's
// start_url says the same). A computer opens on Saved texts (§25): nobody
// photographs books with one — it's where Extract's texts are picked up.
export default async function Home() {
  redirect(isPhone((await headers()).get("user-agent")) ? "/evaluate" : "/extract/saved");
}
