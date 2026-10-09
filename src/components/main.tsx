"use client";

import { usePathname } from "next/navigation";

// Pages that use the whole window instead of the centred 1400px column.
const FULL_WIDTH = ["/terminal", "/how"];

export function Main({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wide = FULL_WIDTH.includes(pathname);
  return (
    <main className={wide ? "px-5 pb-10 pt-6" : "mx-auto max-w-[1400px] px-6 pb-16 pt-9"}>
      {children}
    </main>
  );
}
