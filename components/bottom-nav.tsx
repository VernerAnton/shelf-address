"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookIcon, CameraIcon, ScanIcon, SiteIcon, TagIcon, TextScanIcon, TreeIcon } from "@/components/icons";

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * Two rows at the bottom, where the thumb rests (docs/spec-corrections.md §22):
 * the main tabs — Sections, Evaluate, Extract — and, while in Sections, its own
 * row just above them: Places, Scan, Catalog. Book pages (/copies) belong to
 * Sections too.
 *
 * Extract has a row of its own as well (§27): BookOps on the left, Text
 * Extract on the right. The Extract tab itself still opens Text Extract, as
 * before — the camera on a phone, Saved texts on a computer.
 */
const MAIN = [
  { href: "/sections", label: "Sections", Icon: TreeIcon, area: ["/sections", "/scan", "/catalog", "/copies"] },
  { href: "/evaluate", label: "Evaluate", Icon: TagIcon, area: ["/evaluate", "/photo-log"] },
  { href: "/extract", label: "Extract", Icon: TextScanIcon, area: ["/extract"] },
] as const;

const SECTIONS = [
  { href: "/sections", label: "Places", Icon: SiteIcon },
  { href: "/scan", label: "Scan", Icon: ScanIcon },
  { href: "/catalog", label: "Catalog", Icon: BookIcon },
] as const;

const EXTRACT = [
  { href: "/extract/bookops", label: "BookOps", Icon: CameraIcon },
  { href: "/extract", label: "Text Extract", Icon: TextScanIcon },
] as const;

const MAIN_ROW = "4rem";
const SUB_ROW = "3rem";

export function BottomNav() {
  const pathname = usePathname();
  const inSections = MAIN[0].area.some((a) => under(pathname, a));
  const inExtract = under(pathname, "/extract");
  const inBookOps = under(pathname, "/extract/bookops");
  const sub = inSections
    ? { label: "Sections", items: SECTIONS.map((item) => ({ ...item, active: under(pathname, item.href) })) }
    : inExtract
      ? // Everything in Extract that isn't BookOps is Text Extract (Saved texts too).
        { label: "Extract", items: EXTRACT.map((item) => ({ ...item, active: (item.href === "/extract/bookops") === inBookOps })) }
      : null;

  return (
    <>
      {/* Keeps the end of the page clear of the rows, whichever are showing. */}
      <div
        aria-hidden
        className="shrink-0"
        style={{ height: `calc(${MAIN_ROW}${sub ? ` + ${SUB_ROW}` : ""} + env(safe-area-inset-bottom))` }}
      />
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        {sub && (
          <nav aria-label={sub.label} className="border-b border-line">
            <ul className="mx-auto flex max-w-md gap-1 px-2 py-1.5" style={{ height: SUB_ROW }}>
              {sub.items.map(({ href, label, Icon, active }) => {
                return (
                  <li key={href} className="flex-1">
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex h-full items-center justify-center gap-1.5 rounded-lg text-sm font-medium ${
                        active ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"
                      }`}
                    >
                      <Icon className="size-4" />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
        <nav aria-label="Main">
          <ul className="mx-auto flex max-w-md">
            {MAIN.map(({ href, label, Icon, area }) => {
              const active = area.some((a) => under(pathname, a));
              return (
                <li key={href} className="flex-1">
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex flex-col items-center justify-center gap-1 text-xs font-medium ${
                      active ? "text-accent" : "text-muted hover:text-foreground"
                    }`}
                    style={{ height: MAIN_ROW }}
                  >
                    <Icon className="size-6" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}
