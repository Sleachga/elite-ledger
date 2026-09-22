"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { Button, Flex, Text } from "@radix-ui/themes";
import { rowAtFraction } from "@/modules/playground/geometry";
import type { ReviewRow } from "@/modules/playground/review";
import { useElementWidth, type RowLink } from "./hooks";
import reviewStyles from "./Review.module.css";
import styles from "./CheckDialog.module.css";

type Zoom = 1 | 2;

/** Where a zoom was asked for: kept under the pointer once the frame has resized. */
interface Anchor {
  /** Pointer, relative to the scroll pane. */
  x: number;
  y: number;
  /** Point of the image, as fractions of its size. */
  fx: number;
  fy: number;
}

/**
 * The screenshot inside the check dialog: fits the pane at 1×, twice that at
 * 2× (button, or double-click on the point to look at), scrolling inside its
 * own pane. When the rows carry their position, the lit row gets a band and a
 * click picks the row under the pointer; otherwise a click zooms.
 */
export function ShotPane({
  src,
  name,
  sizeText,
  rows,
  link,
}: {
  src: string;
  name: string;
  sizeText: string;
  /** The rows shown beside the image (the character filter applied). */
  rows: readonly ReviewRow[];
  link: RowLink;
}) {
  const [paneRef, width] = useElementWidth<HTMLDivElement>();
  const bandRef = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const [zoom, setZoom] = useState<Zoom>(1);
  const linked = rows.some((row) => row.box !== null);
  const band = rows.find((row) => row.id === link.activeRowId)?.box ?? null;
  const frameWidth = width > 0 ? Math.round(width * zoom) : undefined;

  // The frame has its new size: put the anchored point back under the pointer.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    const point = anchor.current;
    if (!pane || !point) return;
    anchor.current = null;
    pane.scrollLeft = point.fx * pane.scrollWidth - point.x;
    pane.scrollTop = point.fy * pane.scrollHeight - point.y;
  }, [zoom, paneRef]);

  // A row pointed at in the list: bring its band into the pane.
  useEffect(() => {
    const pane = paneRef.current;
    const element = bandRef.current;
    if (link.activeFrom !== "rows" || !band || !pane || !element) return;
    const outer = pane.getBoundingClientRect();
    const inner = element.getBoundingClientRect();
    if (inner.top < outer.top) pane.scrollTop -= outer.top - inner.top + 8;
    else if (inner.bottom > outer.bottom) pane.scrollTop += inner.bottom - outer.bottom + 8;
  }, [link.activeFrom, band, paneRef]);

  function fractionUnder(event: MouseEvent<HTMLElement>): { fx: number; fy: number } | null {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return { fx: (event.clientX - rect.left) / rect.width, fy: (event.clientY - rect.top) / rect.height };
  }

  function rowUnder(event: MouseEvent<HTMLElement>): string | null {
    const point = fractionUnder(event);
    return point ? rowAtFraction(rows, point.fy) : null;
  }

  /** Toggle 1× ↔ 2× around the pointer, or around the middle of the pane (the button). */
  function toggleZoom(event?: MouseEvent<HTMLElement>) {
    const pane = paneRef.current;
    if (pane) {
      const outer = pane.getBoundingClientRect();
      const point = event ? fractionUnder(event) : null;
      anchor.current = point
        ? { x: event!.clientX - outer.left, y: event!.clientY - outer.top, ...point }
        : {
            x: pane.clientWidth / 2,
            y: pane.clientHeight / 2,
            fx: pane.scrollWidth > 0 ? (pane.scrollLeft + pane.clientWidth / 2) / pane.scrollWidth : 0.5,
            fy: pane.scrollHeight > 0 ? (pane.scrollTop + pane.clientHeight / 2) / pane.scrollHeight : 0.5,
          };
    }
    setZoom((current) => (current === 1 ? 2 : 1));
  }

  return (
    <div className={styles.shot}>
      <div className={styles.shotBar}>
        <Text size="1" color="gray" truncate>
          {name} · {sizeText}
        </Text>
        <Flex align="center" gap="3" flexShrink="0">
          <Button
            size="1"
            variant="soft"
            color="gray"
            aria-pressed={zoom === 2}
            title={linked ? "Double-click the screenshot to zoom on a spot" : "Click the screenshot to zoom"}
            onClick={() => toggleZoom()}
          >
            {zoom === 1 ? "Zoom 2×" : "Zoom 1×"}
          </Button>
          <Text size="1" asChild>
            <a href={src} target="_blank" rel="noreferrer" style={{ color: "var(--accent-11)" }}>
              Full size
            </a>
          </Text>
        </Flex>
      </div>
      <div ref={paneRef} className={styles.shotScroll} data-zoom={zoom}>
        {/* A pointer shortcut only: by keyboard the rows themselves are the way in. */}
        <div
          className={styles.shotFrame}
          style={{ width: frameWidth }}
          data-linked={linked}
          title={linked ? "Click a row to find it in the list · double-click to zoom" : "Click to zoom"}
          onClick={(event) => {
            if (!linked) {
              toggleZoom(event);
              return;
            }
            const rowId = rowUnder(event);
            if (rowId) link.selectRow(rowId);
          }}
          onDoubleClick={linked ? (event) => toggleZoom(event) : undefined}
          onMouseMove={linked ? (event) => link.setActiveRow(rowUnder(event), "shot") : undefined}
          onMouseLeave={linked ? () => link.setActiveRow(null, "shot") : undefined}
        >
          {/* A blob: preview of the user's own file; next/image has nothing to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.shotImage} src={src} alt={`Screenshot ${name}`} draggable={false} />
          {band && (
            <div
              ref={bandRef}
              className={reviewStyles.band}
              style={{ top: `${band.top * 100}%`, height: `${(band.bottom - band.top) * 100}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
