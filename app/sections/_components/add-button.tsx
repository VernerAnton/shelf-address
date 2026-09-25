import Link from "next/link";
import { PlusIcon } from "@/components/icons";

export function AddButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex h-12 items-center justify-center gap-2 rounded-xl bg-accent font-medium text-accent-contrast active:opacity-90"
    >
      <PlusIcon className="size-5" />
      {label}
    </Link>
  );
}
