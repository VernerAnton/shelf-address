import { redirect } from "next/navigation";

// Scanning (the first tab) arrives in Phase 3. Until then, open on the tree.
export default function Home() {
  redirect("/sections");
}
