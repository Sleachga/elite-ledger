import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { catalog, decoys, rarityBorderHex } from "@/catalog";
import {
  REFERENCE_BORDER_PX,
  REFERENCE_ICON_SIZE,
  SLOT_BACKGROUND,
  compositeReferenceIcon,
  referenceIconPath,
} from "./reference-icons";

const ICONS = path.join(process.cwd(), "public", "icons");

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

/** RGB of one pixel of a PNG. */
async function pixel(png: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(Buffer.from(png)).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at], data[at + 1], data[at + 2]];
}

/** A flat red square with transparent corners, standing in for item art. */
function art(size = 40) {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe("compositeReferenceIcon", () => {
  it("draws the art inside a slot with a border of the given color at 96px", async () => {
    const png = await compositeReferenceIcon(await art(), "#5bb661");

    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", REFERENCE_ICON_SIZE, REFERENCE_ICON_SIZE]);
    // Border, then slot, then art, from the edge inwards.
    expect(await pixel(png, 1, 1)).toEqual(hexToRgb("#5bb661"));
    expect(await pixel(png, REFERENCE_ICON_SIZE - 2, REFERENCE_ICON_SIZE - 2)).toEqual(hexToRgb("#5bb661"));
    expect(await pixel(png, REFERENCE_BORDER_PX + 1, REFERENCE_BORDER_PX + 1)).toEqual(hexToRgb(SLOT_BACKGROUND));
    expect(await pixel(png, 48, 48)).toEqual([255, 0, 0]);
  });

  it("draws no border for Silver Coin (undefined), only the slot", async () => {
    const png = await compositeReferenceIcon(await art(), undefined);

    expect(await pixel(png, 1, 1)).toEqual(hexToRgb(SLOT_BACKGROUND));
    expect(await pixel(png, 48, 48)).toEqual([255, 0, 0]);
  });

  it("keeps the art's aspect ratio and takes a custom size", async () => {
    const tall = await sharp({
      create: { width: 20, height: 60, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const png = await compositeReferenceIcon(tall, "#f93f4e", { size: 48, border: 2, pad: 2 });

    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([48, 48]);
    expect(await pixel(png, 24, 24)).toEqual([0, 0, 255]); // art in the middle
    expect(await pixel(png, 6, 24)).toEqual(hexToRgb(SLOT_BACKGROUND)); // slot beside the narrow art
    expect(await pixel(png, 0, 24)).toEqual(hexToRgb("#f93f4e"));
  });

  it("refuses a border and padding that leave no room for the art", async () => {
    await expect(compositeReferenceIcon(await art(), "#5bb661", { size: 10, border: 3, pad: 3 })).rejects.toThrow(
      /no room/,
    );
  });
});

describe("the shipped reference icons (pnpm icons:ref)", () => {
  it("exist for every tracked item and every decoy, at 96px, with the rarity border", async () => {
    for (const item of [...catalog, ...decoys]) {
      const file = referenceIconPath(ICONS, item.id);
      expect(existsSync(file), `${file} is missing: run pnpm icons:ref`).toBe(true);
      const png = await readFile(file);
      const meta = await sharp(png).metadata();
      expect([meta.width, meta.height], item.id).toEqual([REFERENCE_ICON_SIZE, REFERENCE_ICON_SIZE]);
      const currency = "kind" in item && item.kind === "currency";
      const want = currency ? SLOT_BACKGROUND : rarityBorderHex[item.rarity];
      expect(await pixel(png, 1, 1), `${item.id} border`).toEqual(hexToRgb(want));
    }
  });
});
