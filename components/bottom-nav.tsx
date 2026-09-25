"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookIcon, ScanIcon, TreeIcon } from "@/components/icons";

// §7: Scan / Sections / Catalog, validated in the prototype.
const TABS = [
  { href: "/scan", label: "Scan", Icon: ScanIcon },
  { href: "/sections", label: "Sections", Icon: TreeIcon },
  { href: "/catalog", label: "Catalog", Icon: BookIcon },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${
                  active ? "text-accent" : "text-muted hover:text-foreground"
                }`}
              >
                <Icon className="size-6" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
