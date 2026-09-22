"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { RowSelection } from "./ReviewRows";

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

/** The width of an element, kept current by a ResizeObserver; 0 before the first measure. */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** The row ↔ screenshot link of one entry: which row is lit, and which one was picked on the image. */
export interface RowLink {
  activeRowId: string | null;
  /** Where the lit row was pointed at: on the rows, or on the screenshot itself. */
  activeFrom: "rows" | "shot";
  setActiveRow: (rowId: string | null, from: "rows" | "shot") => void;
  selection: RowSelection | null;
  selectRow: (rowId: string) => void;
}

export function useRowLink(): RowLink {
  const [active, setActive] = useState<{ rowId: string | null; from: "rows" | "shot" }>({
    rowId: null,
    from: "rows",
  });
  const [selection, setSelection] = useState<RowSelection | null>(null);
  return {
    activeRowId: active.rowId,
    activeFrom: active.from,
    setActiveRow: (rowId, from) =>
      setActive((current) => (current.rowId === rowId && current.from === from ? current : { rowId, from })),
    selection,
    selectRow: (rowId) => setSelection((current) => ({ rowId, nonce: (current?.nonce ?? 0) + 1 })),
  };
}
