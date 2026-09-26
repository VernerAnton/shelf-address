import { BookIcon } from "@/components/icons";

const SIZES = {
  sm: "h-14 w-10 rounded",
  md: "h-24 w-16 rounded-md",
  lg: "h-48 w-32 rounded-lg",
} as const;

/** A cover from R2, or a plain placeholder when the book has none. */
export function BookCover({ src, size = "sm", alt = "" }: { src: string | null; size?: keyof typeof SIZES; alt?: string }) {
  if (!src) {
    return (
      <span aria-hidden className={`${SIZES[size]} flex shrink-0 items-center justify-center bg-line/70 text-muted`}>
        <BookIcon className={size === "lg" ? "size-10" : "size-5"} />
      </span>
    );
  }
  return (
    // Plain <img>: covers are already sized and served immutable from R2;
    // Next's image optimiser would need a Cloudflare Images binding for no gain.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" className={`${SIZES[size]} shrink-0 bg-line/70 object-cover shadow-sm`} />
  );
}
