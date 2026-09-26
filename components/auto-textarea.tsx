"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/**
 * A textarea that starts at `rows` lines and grows with its content, so a
 * short note stays one line and a long one is never cut off or scrolled.
 */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useLayoutEffect(fit, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      {...props}
      onInput={(e) => {
        fit();
        props.onInput?.(e);
      }}
      className={`resize-none overflow-hidden ${props.className ?? ""}`}
    />
  );
}
