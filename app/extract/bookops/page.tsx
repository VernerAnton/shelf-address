import { headers } from "next/headers";
import { isPhone } from "@/lib/device";
import { BookOpsPhone } from "./bookops-phone";
import { BookOpsScreen } from "./bookops-screen";

/**
 * BookOps (docs/spec-corrections.md §30), the left-hand option in the Extract
 * tab. On a computer: the whole screen — queue, book, camera. On a phone: the
 * phone as the camera, sending books to the computer. Phone or computer as
 * everywhere else (lib/device.ts).
 */
export default async function BookOpsPage() {
  if (isPhone((await headers()).get("user-agent"))) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-6 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">BookOps</h1>
        <BookOpsPhone />
      </main>
    );
  }
  return (
    <main className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-4 px-4 pt-6 pb-6 lg:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">BookOps</h1>
      <BookOpsScreen />
    </main>
  );
}
