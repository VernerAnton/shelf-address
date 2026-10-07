import { redirect } from "next/navigation";

// The app opens on Evaluate (docs/spec-corrections.md §20); the manifest's start_url says the same.
export default function Home() {
  redirect("/evaluate");
}
