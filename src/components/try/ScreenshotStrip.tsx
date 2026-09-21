"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Text } from "@radix-ui/themes";
import { stripLayout } from "@/modules/playground/geometry";
import type { RowBox } from "@/modules/playground/review";
import type { ImageSize } from "./hooks";
import styles from "./Review.module.css";

/**
 * One row cut out of the screenshot and enlarged (the row plus 40% above and
 * below, at 2× the screenshot's pixels or more), so the real icon can be held
 * against the picker's tiles. Wider than its box: it scrolls sideways.
 */
export function ScreenshotStrip({
  src,
  box,
  natural,
  label = "From your screenshot",
}: {
  src: string;
  box: RowBox;
  natural: ImageSize;
  label?: string;
}) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = stripLayout(box, natural, width);

  return (
    <figure className={styles.strip}>
      <Text size="1" color="gray" weight="medium" asChild>
        <figcaption>{label}</figcaption>
      </Text>
      <div
        ref={viewport}
        className={styles.stripViewport}
        style={{ height: Math.round(layout.height) }}
        // Scrollable, so reachable by keyboard.
        tabIndex={layout.imageWidth > width + 1 ? 0 : undefined}
        role="img"
        aria-label="This row, enlarged from your screenshot"
      >
        {/* A blob: URL of the user's own file, cropped by offset; next/image has nothing to add. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.stripImage}
          src={src}
          alt=""
          draggable={false}
          style={{
            width: Math.round(layout.imageWidth),
            height: Math.round(layout.imageHeight),
            marginTop: -Math.round(layout.offsetY),
          }}
        />
      </div>
    </figure>
  );
}
