"use client";

import { useEffect } from "react";

/**
 * Run `fn` now and then every `ms`, but only while the tab is visible. A tab
 * left open in the background stops asking the server for data, and catches
 * up the moment it is looked at again. `alive()` turns false once the inputs
 * change or the component unmounts, so a late response can be ignored.
 */
export function usePoll(fn: (alive: () => boolean) => void | Promise<void>, ms: number, deps: unknown[]): void {
  useEffect(() => {
    let live = true;
    const alive = () => live;
    void fn(alive); // always load once, even if the tab starts in the background
    const timer = setInterval(() => {
      if (!document.hidden) void fn(alive);
    }, ms);
    const onVisible = () => {
      if (!document.hidden) void fn(alive);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
