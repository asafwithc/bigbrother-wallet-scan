"use client";

import { useEffect, useState } from "react";

const GLYPHS = "01#$%&<>/\\[]{}=+*";
const FRAMES = 22;
const FRAME_MS = 32;

/**
 * Text that "decodes" into place on load: random glyphs resolving left to
 * right in about 0.7s. Screen readers get the plain text, and nothing moves
 * for people who ask for reduced motion.
 */
export function Decode({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      const settled = Math.floor((frame / FRAMES) * text.length);
      setShown(
        [...text]
          .map((ch, i) => (i < settled || ch === " " ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]))
          .join("")
      );
      if (frame >= FRAMES) {
        clearInterval(id);
        setShown(text);
      }
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [text]);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}

/** Small "// section" label above a page title. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mono text-[12px] uppercase tracking-[0.22em] text-matrix/80">
      <span className="text-matrix/50">{"// "}</span>
      {children}
    </div>
  );
}
