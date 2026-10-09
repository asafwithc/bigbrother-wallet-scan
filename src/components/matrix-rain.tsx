"use client";

import { useEffect, useRef } from "react";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789";
const FONT_PX = 15;
const COLUMN_PX = 26; // sparse columns: atmosphere, not noise
const FRAME_MS = 70;

/**
 * Digital rain behind the whole app. Purely decorative: it sits under the
 * content, ignores the pointer, pauses while the tab is hidden and stands
 * still for people who ask for reduced motion.
 */
export function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    // opaque canvas: the browser can skip blending it with what is underneath
    const ctx = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !ctx) return;

    let drops: number[] = [];
    let width = 0;
    let height = 0;
    let timer: ReturnType<typeof setInterval> | undefined;

    const resize = () => {
      // Rendered at 1x on purpose: it is a faint background, and a retina
      // canvas would mean repainting four times the pixels every frame.
      if (window.innerWidth === width && window.innerHeight === height) return;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      ctx.fillStyle = "#030806";
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${FONT_PX}px ui-monospace, Menlo, monospace`;
      // start the columns at different heights above the screen
      drops = Array.from({ length: Math.ceil(width / COLUMN_PX) }, () => -Math.random() * 60);
    };

    const step = () => {
      // fade what's there instead of clearing: that's what leaves the trails
      ctx.fillStyle = "rgba(3, 8, 6, 0.1)";
      ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < drops.length; i++) {
        const y = drops[i] * FONT_PX;
        if (y > 0) {
          ctx.fillStyle = Math.random() < 0.07 ? "#d8ffe8" : "#22e07a";
          ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * COLUMN_PX, y);
        }
        drops[i] = y > height && Math.random() > 0.975 ? -Math.random() * 20 : drops[i] + 1;
      }
    };

    resize();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (let i = 0; i < 70; i++) step(); // one still frame
    } else {
      // ~15 frames a second is plenty for falling text; skip frames nobody can see
      timer = setInterval(() => {
        if (!document.hidden) step();
      }, FRAME_MS);
    }
    window.addEventListener("resize", resize);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-40"
    />
  );
}
