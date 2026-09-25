import { redirect } from "next/navigation";

// The app opens on scanning, the everyday task (§7: Scan / Sections / Catalog).
export default function Home() {
  redirect("/scan");
}
