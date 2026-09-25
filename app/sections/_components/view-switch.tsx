import Link from "next/link";

/** Tree (drill-down) vs. the flat A–Z list of shelf addresses. */
export function ViewSwitch({ active }: { active: "tree" | "addresses" }) {
  const tab = (key: "tree" | "addresses", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`flex-1 rounded-md py-1.5 text-center text-sm font-medium ${
        active === key ? "bg-surface shadow-sm" : "text-muted"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex gap-1 rounded-lg bg-line/60 p-1">
      {tab("tree", "/sections", "Tree")}
      {tab("addresses", "/sections/addresses", "Addresses A–Z")}
    </div>
  );
}
