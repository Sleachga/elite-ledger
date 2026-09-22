/**
 * Reference icons for the prompt: the codex art inside a dark slot with the
 * in-game rarity border, so the model can compare a row's border color with
 * the reference's as well as the art. The bare codex PNGs in `public/icons/`
 * stay as they are for the site's ItemChip.
 *
 * In the bank log an icon sits in a ~48px slot with a thin colored border.
 * The reference is drawn at twice that (96px, a 3px border, so about 1.5px
 * in-game) and written to `public/icons/ref/<id>.png` by
 * `pnpm icons:ref` (`scripts/make-reference-icons.ts`). The files are
 * committed: the prompt reads them at request time, and Vercel traces
 * `public/icons/**` into the extraction route.
 */
import path from "node:path";

export const REFERENCE_ICON_DIR = "ref";
export const REFERENCE_ICON_SIZE = 96;
export const REFERENCE_BORDER_PX = 3;
/** Gap between the border and the art. */
export const REFERENCE_ART_PAD = 4;
/** The dark slot the game draws icons on. */
export const SLOT_BACKGROUND = "#0b0d10";

/** `<iconsDir>/ref/<id>.png`. */
export function referenceIconPath(iconsDir: string, id: string): string {
  return path.join(iconsDir, REFERENCE_ICON_DIR, `${id}.png`);
}

export interface ReferenceIconOptions {
  /** Edge of the square output, in px. */
  size?: number;
  /** Border width in px; ignored when there is no border color. */
  border?: number;
  /** Gap between the border and the art, in px. */
  pad?: number;
  /** Slot color behind the art. */
  background?: string;
}

/**
 * Composite `art` (a PNG/JPEG/WebP with or without alpha) centred on a slot
 * with a border of `borderHex`, or with no border at all when `borderHex` is
 * undefined (Silver Coin has none in the log). Returns a PNG.
 */
export async function compositeReferenceIcon(
  art: Uint8Array,
  borderHex: string | undefined,
  options: ReferenceIconOptions = {},
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const size = options.size ?? REFERENCE_ICON_SIZE;
  const border = borderHex === undefined ? 0 : (options.border ?? REFERENCE_BORDER_PX);
  const pad = options.pad ?? REFERENCE_ART_PAD;
  const background = options.background ?? SLOT_BACKGROUND;
  const inner = size - 2 * (border + pad);
  if (inner < 1) throw new Error("reference icon: border and padding leave no room for the art");

  const scaled = await sharp(Buffer.from(art.buffer, art.byteOffset, art.byteLength))
    .resize({ width: inner, height: inner, fit: "inside" })
    .png()
    .toBuffer();
  const { width = inner, height = inner } = await sharp(scaled).metadata();

  const layers: { input: Buffer; left: number; top: number }[] = [];
  if (border > 0) {
    const slot = await sharp({
      create: { width: size - 2 * border, height: size - 2 * border, channels: 4, background },
    })
      .png()
      .toBuffer();
    layers.push({ input: slot, left: border, top: border });
  }
  layers.push({
    input: scaled,
    left: Math.round((size - width) / 2),
    top: Math.round((size - height) / 2),
  });

  return sharp({
    create: { width: size, height: size, channels: 4, background: borderHex ?? background },
  })
    .composite(layers)
    .png()
    .toBuffer();
}
