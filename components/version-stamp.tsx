import { APP_VERSION, BUILD_COMMIT, BUILD_TIME } from "@/lib/version";

/**
 * "V3" at the foot of every tab, so picking up a phone answers "am I on the
 * current build?" at a glance. The commit and build time sit on a smaller line
 * beneath rather than in a tooltip, because a phone can't hover; the tooltip is
 * set too, for desktop.
 */
export function VersionStamp() {
  const detail = [BUILD_COMMIT, BUILD_TIME && `${BUILD_TIME} UTC`].filter(Boolean).join(" · ");
  return (
    <footer className="px-4 pt-2 pb-4 text-center text-muted" title={`Build ${detail}`}>
      <p className="text-xs font-semibold">V{APP_VERSION}</p>
      <p className="font-mono text-[11px] leading-4">{detail}</p>
    </footer>
  );
}
