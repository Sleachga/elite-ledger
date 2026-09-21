"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** Rail + detail from here up; stacked cards below. */
export const DESKTOP_QUERY = "(min-width: 1024px)";
/** Room for the screenshot beside the rows table; below this (down to 1024px) it sits on top of it. */
export const BESIDE_QUERY = "(min-width: 1280px)";
/** Rows are a table from here up (Radix `sm`), cards below; pickers become bottom sheets below. */
export const TABLE_QUERY = "(min-width: 768px)";

/** A media query as state. Phones first: the server (and the first paint) sees `false`. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export interface ImageSize {
  width: number;
  height: number;
}

/** The natural pixel size of an image, once it has loaded; null before that (and for no image). */
export function useImageSize(src: string | null): ImageSize | null {
  const [loaded, setLoaded] = useState<{ src: string; size: ImageSize } | null>(null);

  useEffect(() => {
    if (!src) return;
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (live) setLoaded({ src, size: { width: image.naturalWidth, height: image.naturalHeight } });
    };
    image.src = src;
    return () => {
      live = false;
    };
  }, [src]);

  return loaded && loaded.src === src ? loaded.size : null;
}
