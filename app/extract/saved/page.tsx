import { SavedTexts } from "./saved-texts";

// All on the client: the list comes from /api/extract/texts behind the access-code login.
// A big screen showing a front cover (§28) gets more width: the cover beside the text needs it.
export default function SavedTextsPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-6 pb-6 md:max-w-5xl xl:has-[figure]:max-w-[96rem]">
      <h1 className="text-2xl font-semibold tracking-tight">Saved texts</h1>
      <SavedTexts />
    </main>
  );
}
