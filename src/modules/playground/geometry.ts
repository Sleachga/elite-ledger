/**
 * Row ↔ screenshot geometry. Everything is a fraction (0–1) of the screenshot
 * height, so it holds at whatever size the image is drawn.
 */
import type { RowBox } from "./review";

/** How much of the row's own height is shown above and below it in an enlarged strip. */
export const STRIP_PADDING = 0.4;
/** Enlarged strips are drawn at least this many times the screenshot's own pixels. */
export const STRIP_MIN_SCALE = 2;

/** The slice of the screenshot an enlarged strip shows: the row plus padding, kept inside the image. */
export function stripWindow(box: RowBox, padding: number = STRIP_PADDING): RowBox {
  const pad = (box.bottom - box.top) * padding;
  return { top: Math.max(0, box.top - pad), bottom: Math.min(1, box.bottom + pad) };
}

export interface StripLayout {
  /** Drawn size of the whole screenshot inside the strip. */
  imageWidth: number;
  imageHeight: number;
  /** Visible height of the strip. */
  height: number;
  /** How far the image is pulled up so the window starts at the strip's top edge. */
  offsetY: number;
}

/**
 * Pixel layout of an enlarged strip. The scale is at least `STRIP_MIN_SCALE`,
 * and more when that would leave the strip narrower than its container.
 */
export function stripLayout(
  box: RowBox,
  natural: { width: number; height: number },
  containerWidth: number,
): StripLayout {
  const window = stripWindow(box);
  const scale = Math.max(STRIP_MIN_SCALE, natural.width > 0 ? containerWidth / natural.width : 0);
  const imageWidth = natural.width * scale;
  const imageHeight = natural.height * scale;
  return {
    imageWidth,
    imageHeight,
    height: (window.bottom - window.top) * imageHeight,
    offsetY: window.top * imageHeight,
  };
}

/**
 * The row under a click at height `y` (fraction of the screenshot). Boxes from
 * a model may overlap a little: the row whose middle is nearest wins.
 */
export function rowAtFraction(rows: readonly { id: string; box: RowBox | null }[], y: number): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const row of rows) {
    if (!row.box || y < row.box.top || y > row.box.bottom) continue;
    const distance = Math.abs((row.box.top + row.box.bottom) / 2 - y);
    if (best === null || distance < best.distance) best = { id: row.id, distance };
  }
  return best?.id ?? null;
}
