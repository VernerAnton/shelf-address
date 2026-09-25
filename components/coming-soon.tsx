export function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-muted">{body}</p>
    </main>
  );
}
