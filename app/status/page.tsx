import { checkBindings, type BindingStatus } from "@/lib/health";

// Reads D1 and R2 on every request, so it must never be prerendered at build
// time (where no bindings exist).
export const dynamic = "force-dynamic";

function StatusRow({
  label,
  status,
}: {
  label: string;
  status: BindingStatus;
}) {
  return (
    <li className="flex items-start gap-3 py-3 border-b border-black/10 dark:border-white/15 last:border-0">
      <span
        aria-hidden
        className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
          status.ok ? "bg-emerald-500" : "bg-red-500"
        }`}
      />
      <span className="flex-1 min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-sm opacity-70 break-words">
          {status.detail}
        </span>
      </span>
      <span className="sr-only">{status.ok ? "ok" : "failing"}</span>
    </li>
  );
}

export default async function StatusPage() {
  const health = await checkBindings();

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
      <p className="mt-2 text-sm opacity-70">
        Whether the app can reach its database and image storage.
      </p>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider opacity-60">
          Bindings
        </h2>
        <ul className="mt-2">
          <StatusRow label="D1 — database" status={health.d1} />
          <StatusRow label="R2 — media bucket" status={health.r2} />
        </ul>
      </section>

      {health.tables.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider opacity-60">
            Schema
          </h2>
          <ul className="mt-2 font-mono text-sm">
            {health.tables.map((table) => (
              <li
                key={table.name}
                className="flex justify-between py-2 border-b border-black/10 dark:border-white/15 last:border-0"
              >
                <span>{table.name}</span>
                <span className="opacity-70">
                  {table.rows} {table.rows === 1 ? "row" : "rows"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
