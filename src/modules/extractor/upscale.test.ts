import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPSCALE_LIMITS,
  MAX_UPSCALED_BYTES,
  computeUpscale,
  prepareScreenshot,
  visualTokens,
} from "./upscale";

const HIGH_RES = { ...DEFAULT_UPSCALE_LIMITS, maxLongEdge: 2576 };

describe("computeUpscale", () => {
  it("doubles a small screenshot", () => {
    expect(computeUpscale(640, 480)).toBe(2);
    expect(computeUpscale(784, 600)).toBe(2); // 1568 long edge exactly
  });

  it("stops at the long-edge limit", () => {
    expect(computeUpscale(780, 990)).toBeCloseTo(1568 / 990, 10);
    expect(computeUpscale(1200, 700)).toBeCloseTo(1568 / 1200, 10);
  });

  it("sends the image as it is when the gain would be under 1.15x", () => {
    expect(computeUpscale(1400, 900)).toBe(1); // 1.12x
    expect(computeUpscale(1363, 900)).toBeCloseTo(1568 / 1363, 10); // just over 1.15x
    expect(computeUpscale(1568, 882)).toBe(1);
  });

  it("never downscales", () => {
    expect(computeUpscale(1920, 1080)).toBe(1);
    expect(computeUpscale(3840, 2160)).toBe(1);
  });

  it("returns 1 for sizes that make no sense", () => {
    expect(computeUpscale(0, 100)).toBe(1);
    expect(computeUpscale(Number.NaN, 100)).toBe(1);
    expect(computeUpscale(-5, -5)).toBe(1);
  });

  it("takes a higher long-edge limit for the high-resolution model tier", () => {
    expect(computeUpscale(780, 990, HIGH_RES)).toBe(2);
    expect(computeUpscale(1920, 1080, HIGH_RES)).toBeCloseTo(2576 / 1920, 10);
  });

  it("keeps the enlarged image inside the visual-token budget", () => {
    // A square at 2576px would be 92 x 92 = 8464 patches; the budget is 4784.
    const scale = computeUpscale(1288, 1288, HIGH_RES);
    expect(scale).toBeGreaterThan(1.15);
    expect(scale).toBeLessThan(2);
    expect(visualTokens(Math.round(1288 * scale), Math.round(1288 * scale))).toBeLessThanOrEqual(
      HIGH_RES.maxVisualTokens,
    );
  });
});

describe("visualTokens", () => {
  it("counts started 28px patches on each axis", () => {
    expect(visualTokens(1000, 1000)).toBe(36 * 36);
    expect(visualTokens(1920, 1080)).toBe(69 * 39);
    expect(visualTokens(28, 29)).toBe(2);
  });
});

function flatImage(width: number, height: number, format: "png" | "jpeg" = "png") {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 22, g: 25, b: 30 } },
  });
  return (format === "png" ? image.png() : image.jpeg()).toBuffer();
}

describe("prepareScreenshot", () => {
  it("sends a Lanczos-enlarged PNG of a small upload", async () => {
    const upload = await flatImage(400, 300);
    const prepared = await prepareScreenshot(upload, "image/png", { enabled: true });

    expect(prepared.upscale).toEqual({ applied: true, scale: 2, width: 400, height: 300 });
    expect(prepared.mediaType).toBe("image/png");
    const sent = await sharp(Buffer.from(prepared.data)).metadata();
    expect([sent.format, sent.width, sent.height]).toEqual(["png", 800, 600]);
    expect(prepared.data.byteLength).toBeLessThanOrEqual(MAX_UPSCALED_BYTES);
  });

  it("re-encodes a JPEG upload as PNG and says so in the media type", async () => {
    const upload = await flatImage(500, 900, "jpeg");
    const prepared = await prepareScreenshot(upload, "image/jpeg", { enabled: true });

    expect(prepared.upscale.applied).toBe(true);
    expect(prepared.upscale.scale).toBeCloseTo(1568 / 900, 10);
    expect(prepared.mediaType).toBe("image/png");
    const sent = await sharp(Buffer.from(prepared.data)).metadata();
    expect([sent.format, sent.width, sent.height]).toEqual(["png", 871, 1568]);
  });

  it("passes a large upload through untouched", async () => {
    const upload = await flatImage(1920, 1080, "jpeg");
    const prepared = await prepareScreenshot(upload, "image/jpeg", { enabled: true });

    expect(prepared.data).toBe(upload);
    expect(prepared.mediaType).toBe("image/jpeg");
    expect(prepared.upscale).toMatchObject({ applied: false, scale: 1, width: 1920, height: 1080 });
  });

  it("backs off to a smaller enlargement when the PNG would be too heavy", async () => {
    // Noise barely compresses: 2x of this is over the byte cap, 1.5x is under it.
    const upload = await sharp({
      create: {
        width: 784,
        height: 784,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
        noise: { type: "gaussian", mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();
    const prepared = await prepareScreenshot(upload, "image/png", { enabled: true });

    expect(prepared.upscale).toMatchObject({ applied: true, scale: 1.5 });
    expect(prepared.data.byteLength).toBeLessThanOrEqual(MAX_UPSCALED_BYTES);
  });

  it("does nothing when switched off", async () => {
    const upload = await flatImage(400, 300);
    const prepared = await prepareScreenshot(upload, "image/png", { enabled: false });

    expect(prepared.data).toBe(upload);
    expect(prepared.upscale).toEqual({ applied: false, scale: 1, reason: "upscaling is switched off" });
  });

  it("passes on bytes it cannot read instead of failing", async () => {
    const upload = new Uint8Array([137, 80, 78, 71]);
    const prepared = await prepareScreenshot(upload, "image/png", { enabled: true });

    expect(prepared.data).toBe(upload);
    expect(prepared.mediaType).toBe("image/png");
    expect(prepared.upscale.applied).toBe(false);
    expect(prepared.upscale.reason).toMatch(/could not be processed/);
  });
});
