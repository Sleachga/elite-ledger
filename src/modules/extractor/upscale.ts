/**
 * Enlarge small screenshots before they go to the model (issue #19).
 *
 * In the bank log an item icon is about 48px, and what tells the four
 * blueprint fragments apart is a ~30px piece of jewelry; the inline silver
 * amount is small text. A Lanczos upscale gives the model more patches per
 * icon and per digit. It never downscales, and it stays inside what the API
 * accepts without resizing the image itself, so the enlargement is not undone
 * server side.
 *
 * `box` coordinates in the answer are fractions of the image height, so they
 * apply to the original upload whatever was sent.
 */
import type { ImageMediaType } from "./prompt";

export interface UpscaleLimits {
  /** Never enlarge by more than this. */
  maxScale: number;
  /** Below this the gain is not worth re-encoding: send the upload as it is. */
  minScale: number;
  /** Longest edge, in px, of the image that is sent. */
  maxLongEdge: number;
  /** The API's per-image patch budget (one visual token = one 28x28px patch). */
  maxVisualTokens: number;
}

/**
 * 1568px is the long edge every current model takes without resizing. The
 * high-resolution tier (Claude Opus 4.7 and later, which includes
 * claude-opus-5) accepts 2576px and 4784 visual tokens; `maxLongEdge` can be
 * raised to that with `deps.upscaleMaxEdge` / `EXTRACTOR_UPSCALE_MAX_EDGE`.
 */
export const DEFAULT_UPSCALE_LIMITS: UpscaleLimits = {
  maxScale: 2,
  minScale: 1.15,
  maxLongEdge: 1568,
  maxVisualTokens: 4784,
};

/** Re-encoded PNGs above this are not sent (base64 adds a third; the API takes 10 MB encoded). */
export const MAX_UPSCALED_BYTES = Math.floor(4.5 * 1024 * 1024);

const PATCH = 28;

export function visualTokens(width: number, height: number): number {
  return Math.ceil(width / PATCH) * Math.ceil(height / PATCH);
}

/**
 * The factor to enlarge a `width` x `height` image by, or 1 to send it as it
 * is. `min(maxScale, maxLongEdge / longEdge)`, further limited by the patch
 * budget, and only when that comes to at least `minScale`. Pure.
 */
export function computeUpscale(
  width: number,
  height: number,
  limits: UpscaleLimits = DEFAULT_UPSCALE_LIMITS,
): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return 1;
  const longEdge = Math.max(width, height);
  let scale = Math.min(limits.maxScale, limits.maxLongEdge / longEdge);
  if (visualTokens(width * scale, height * scale) > limits.maxVisualTokens) {
    // A started patch counts as a whole one, so solve (a*s + 1)(b*s + 1) = budget
    // for s, with a and b the image's size in patches.
    const a = width / PATCH;
    const b = height / PATCH;
    const root = Math.sqrt((a + b) ** 2 + 4 * a * b * (limits.maxVisualTokens - 1));
    scale = Math.min(scale, (root - (a + b)) / (2 * a * b));
  }
  return scale >= limits.minScale ? scale : 1;
}

export interface UpscaleReport {
  /** Whether the image that was sent is an enlarged copy of the upload. */
  applied: boolean;
  /** Enlargement factor; 1 when the upload was sent as it is. */
  scale: number;
  /** Pixel size of the upload, when it could be read. */
  width?: number;
  height?: number;
  /** Why the upload was sent as it is. */
  reason?: string;
}

export interface PreparedImage {
  data: Uint8Array;
  mediaType: ImageMediaType;
  upscale: UpscaleReport;
}

type Sharp = (typeof import("sharp"))["default"];
let sharpModule: Promise<Sharp> | undefined;

// Loaded on first use, so that a missing native binary degrades to "sent as
// uploaded" (and says so in the result) instead of taking the whole route down.
function loadSharp(): Promise<Sharp> {
  sharpModule ??= import("sharp").then((module) => module.default);
  return sharpModule;
}

/**
 * Returns what to send for an upload: a Lanczos-enlarged PNG when that helps,
 * otherwise the upload untouched. Never throws: an image that cannot be read
 * here is passed on as it is, and the API gets to judge it.
 */
export async function prepareScreenshot(
  image: Uint8Array,
  mediaType: ImageMediaType,
  options: { enabled: boolean; limits?: UpscaleLimits },
): Promise<PreparedImage> {
  const asUploaded = (upscale: Omit<UpscaleReport, "applied" | "scale">): PreparedImage => ({
    data: image,
    mediaType,
    upscale: { applied: false, scale: 1, ...upscale },
  });
  if (!options.enabled) return asUploaded({ reason: "upscaling is switched off" });

  try {
    const sharp = await loadSharp();
    const input = Buffer.from(image.buffer, image.byteOffset, image.byteLength);
    const { width, height } = await sharp(input).metadata();
    if (!width || !height) return asUploaded({ reason: "the image size could not be read" });

    const full = computeUpscale(width, height, options.limits);
    if (full === 1) {
      return asUploaded({ width, height, reason: "the image is already large enough" });
    }
    // If the enlarged PNG is too heavy, try half the enlargement once.
    const limits = options.limits ?? DEFAULT_UPSCALE_LIMITS;
    const candidates = [full, (1 + full) / 2].filter((scale) => scale >= limits.minScale);
    for (const scale of candidates) {
      const data = await sharp(input)
        .resize({
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          fit: "fill",
          kernel: "lanczos3",
        })
        .png()
        .toBuffer();
      if (data.byteLength <= MAX_UPSCALED_BYTES) {
        return {
          data,
          mediaType: "image/png",
          upscale: { applied: true, scale, width, height },
        };
      }
    }
    return asUploaded({ width, height, reason: "the enlarged image would be too large to send" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return asUploaded({ reason: `the image could not be processed (${message})` });
  }
}
