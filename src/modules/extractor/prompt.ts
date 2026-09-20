/**
 * The prompt: a frozen system prompt, then one user turn laid out so the
 * expensive, never-changing part (system + labelled reference icons) is a
 * stable prefix that prompt caching can reuse across uploads:
 *
 *   system | [label, icon] x N (cache breakpoint on the last icon) | screenshot | ask
 *
 * Nothing volatile (names, timestamps, ids) may appear before the breakpoint.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { CatalogItem } from "@/catalog";
import { ExtractorError } from "./errors";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";

type ContentBlock = Anthropic.Beta.BetaContentBlockParam;
type ImageBlock = Anthropic.Beta.BetaImageBlockParam;

export const SYSTEM_PROMPT = `You transcribe screenshots of the guild bank log from the MMO "The Quinfall" into structured rows. Your output is shown to the uploader next to the screenshot for verification before anything is saved, and leadership uses the saved rows to decide who earns rewards, so a faithful reading matters more than a complete-looking one.

What the log looks like: a vertical list of dark rows. Each row shows, left to right:
- a direction arrow: a green upward triangle for a deposit; withdrawals have a different, non-green arrow;
- an item icon with a rarity-coloured border, with the stack size overlaid on the icon in small white digits. No overlaid number means a stack of exactly 1;
- the word "Deposit" in green (or "Withdraw");
- a timestamp in the form "DD.MM.YYYY - HH:MM";
- the name of the character who made the transaction.
Silver Coin rows are the exception: a coin-bag icon with the amount printed inline to the right of the icon in gold text with thousands separators (for example "500,000,000"), not overlaid on the icon.

Item names never appear in the log, so an item's identity comes only from its icon. The user message begins with a labelled reference icon for every tracked item. Compare each row's icon with those references (artwork first, border colour as a tiebreak) and answer with the id from the matching label. If the icon is not one of the tracked items, or you cannot tell which it is, answer "unknown" rather than the nearest guess. The Silver Coin reference is only an approximation of the in-game art; recognise silver rows by the coin icon together with the inline gold amount.

How to report:
- One entry per visible log row, top to bottom, withdrawals included. Withdrawals are filtered out downstream, so report the direction faithfully: "deposit" only when the row has the green up arrow and says Deposit, "withdraw" for a withdrawal, "unknown" if the row is cut off or you cannot tell.
- Rows that look identical are separate transactions. Report each one; never merge or de-duplicate.
- quantity: the number exactly as displayed, separators included, or an empty string when no number is shown. For Silver Coin it is the inline amount. Read every digit; amounts can exceed ten billion.
- gameTimestamp and character: exactly as displayed. Do not reformat the timestamp or convert time zones, and keep the name's capitalisation. Known character names, when given, are only there to settle an ambiguous glyph, never to replace a name that clearly reads differently.
- iconDescription: one short sentence on what the icon looks like (shape, colours, border colour), without naming the item, so that someone who cannot see the image could pick it from a list.
- confidence: your honest probability, 0 to 1, that every field of the row is right. When it is below about 0.8, say what is doubtful in lowConfidenceReason; otherwise leave it empty.
- notes: anything the person verifying should know, such as partially visible rows, blur, or UI covering the log. Leave it empty when there is nothing to say.
- If the image is not a bank log of this kind, set looksLikeBankLog to false and return no rows.`;

const MEDIA_TYPE_BY_EXTENSION: Record<string, ImageMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export function defaultIconsDir(): string {
  return path.join(process.cwd(), "public", "icons");
}

// Icons never change while the process lives; read and encode each one once.
const iconCache = new Map<string, Promise<ImageBlock["source"]>>();

async function readIcon(file: string): Promise<ImageBlock["source"]> {
  const mediaType = MEDIA_TYPE_BY_EXTENSION[path.extname(file).toLowerCase()];
  if (!mediaType) {
    throw new ExtractorError("config", `Reference icon "${file}" is not a PNG, JPEG or WebP file.`);
  }
  try {
    const bytes = await readFile(file);
    return { type: "base64", media_type: mediaType, data: bytes.toString("base64") };
  } catch (cause) {
    throw new ExtractorError("config", `Could not read reference icon "${file}".`, { cause });
  }
}

function loadIcon(file: string): Promise<ImageBlock["source"]> {
  let cached = iconCache.get(file);
  if (!cached) {
    cached = readIcon(file);
    cached.catch(() => iconCache.delete(file));
    iconCache.set(file, cached);
  }
  return cached;
}

export function referenceLabel(item: Pick<CatalogItem, "id" | "name" | "rarity">): string {
  return `Reference icon — id: ${item.id}, name: ${item.name}, rarity: ${item.rarity}`;
}

function askText(knownCharacters: readonly string[]): string {
  const names = knownCharacters.map((name) => name.trim()).filter((name) => name !== "");
  const known =
    names.length > 0
      ? `The uploader's known character names: ${names.join(", ")}. Other names may appear too.`
      : "The uploader has no known character names yet.";
  return `The image directly above is the uploaded screenshot. ${known} Transcribe every log row you can see.`;
}

export interface BuildContentInput {
  catalog: readonly CatalogItem[];
  iconsDir: string;
  screenshot: { data: Uint8Array; mediaType: ImageMediaType };
  knownCharacters: readonly string[];
}

export async function buildUserContent(input: BuildContentInput): Promise<ContentBlock[]> {
  const { catalog, iconsDir, screenshot, knownCharacters } = input;
  if (catalog.length === 0) {
    throw new ExtractorError("config", "The catalog has no tracked items to match against.");
  }
  const icons = await Promise.all(
    catalog.map((item) => loadIcon(path.resolve(iconsDir, item.icon))),
  );

  const content: ContentBlock[] = [];
  catalog.forEach((item, index) => {
    content.push({ type: "text", text: referenceLabel(item) });
    const icon: ImageBlock = { type: "image", source: icons[index] };
    // Cache breakpoint on the last reference icon: everything up to here is
    // identical for every upload.
    if (index === catalog.length - 1) icon.cache_control = { type: "ephemeral" };
    content.push(icon);
  });

  content.push({
    type: "image",
    source: {
      type: "base64",
      media_type: screenshot.mediaType,
      data: Buffer.from(
        screenshot.data.buffer,
        screenshot.data.byteOffset,
        screenshot.data.byteLength,
      ).toString("base64"),
    },
  });
  content.push({ type: "text", text: askText(knownCharacters) });
  return content;
}
