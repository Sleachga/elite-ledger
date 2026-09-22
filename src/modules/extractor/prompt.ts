/**
 * The prompt: a frozen system prompt, then one user turn laid out so the
 * expensive, never-changing part (system + labelled reference icons) is a
 * stable prefix that prompt caching can reuse across uploads:
 *
 *   system | [label, icon] x tracked | [label, icon] x decoys (cache breakpoint on the last icon) | screenshot | ask
 *
 * Reference icons are the bordered ones from `public/icons/ref/` (see
 * `reference-icons.ts`): tracked items first, then the decoys, untracked
 * items that share art with a tracked one and differ in border, labelled
 * "NOT tracked". Nothing volatile (names, timestamps, ids) may appear before
 * the breakpoint.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { rarityBorderWord, type CatalogItem, type DecoyItem } from "@/catalog";
import { ExtractorError } from "./errors";
import { referenceIconPath } from "./reference-icons";
import { borderLegend } from "./schema";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";

type ContentBlock = Anthropic.Beta.BetaContentBlockParam;
type ImageBlock = Anthropic.Beta.BetaImageBlockParam;

export const SYSTEM_PROMPT = `You transcribe screenshots of the guild bank log from the MMO "The Quinfall" into structured rows. Your output is shown to the uploader next to the screenshot for verification before anything is saved, and leadership uses the saved rows to decide who earns rewards, so a faithful reading matters more than a complete-looking one.

What the log looks like: a vertical list of dark rows. Each row shows, left to right:
- a direction arrow: a green upward triangle for a deposit; withdrawals have a different, non-green arrow;
- an item icon in a dark square slot with a thin coloured border, with the stack size overlaid on the icon in small white digits. No overlaid number means a stack of exactly 1;
- the word "Deposit" in green (or "Withdraw");
- a timestamp in the form "DD.MM.YYYY - HH:MM";
- the name of the character who made the transaction.
Silver Coin rows are the exception: a coin-bag icon with no border, and the amount printed inline to the right of the icon in gold text with thousands separators (for example "500,000,000"), not overlaid on the icon.

An item's identity is its artwork AND its border colour. The border shows the item's rarity: ${borderLegend()}. The game has items that share one piece of artwork and differ only in rarity (and in a detail of the art), so the same art with a different border is a different item. Item names never appear in the log; the user message begins with labelled reference icons, each drawn the way the log draws it, the art in a dark slot with its border. Tracked items come first, then references labelled "NOT tracked": lookalikes that share art with a tracked item but carry another border. Compare each row's icon with the references, art and border both, and answer with the id from the matching tracked label. Answer "unknown" when the art matches a tracked item but the border does not, when the icon matches a NOT tracked reference, or when it is not among the references at all; then say in iconDescription which variant it looks like and what colour its border is. The Silver Coin reference is only an approximation of the in-game art: recognise silver rows by the coin icon, the missing border and the inline gold amount.

Blueprint fragments are the hardest rows and the ones that matter most. All four share one layout: a piece of jewelry in the top-left of the icon and the same grey paper badge in the bottom-right, with the stack number (if any) printed over the badge. The badge only says "this is a fragment"; which fragment it is comes from the jewelry alone, so leave the badge out of the comparison. Each fragment's reference label says what sets its jewelry apart. In the log the jewelry is only about 30 pixels across: look at its metal colour, its gem colour and the gem's shape and size, put that into iconDescription, and then pick the id that description fits.

Silver Coin amounts go wrong by a whole digit group or a single digit, which is a thousandfold or tenfold error. Read the inline number one group at a time, left to right: the leading group has one to three digits and every later group has exactly three. Count the groups (5,000,000 has three; 10,000,000,000 has four) and check that what you wrote has that many. A group that seems to have two or four digits means a misread, so look again.

How to report:
- One entry per visible log row, top to bottom, withdrawals included. Withdrawals are filtered out downstream, so report the direction faithfully: "deposit" only when the row has the green up arrow and says Deposit, "withdraw" for a withdrawal, "unknown" if the row is cut off or you cannot tell.
- Rows that look identical are separate transactions. Report each one; never merge or de-duplicate.
- box: where the row is, as fractions of the full image height (0 is the top edge of the image, 1 the bottom): the row's top edge and its bottom edge. It is used to show the verifier an enlarged strip of that row, so it should cover the whole row and nothing of its neighbours.
- iconDescription: one short sentence on what the icon looks like (shape, colours, border colour), without naming the item, so that someone who cannot see the image could pick it from a list. Write it before you decide on itemId.
- borderColorWord and borderColor: the border's colour in one plain word as you see it ("" when there is no border), and the rarity that colour stands for in the legend above ("none" for no border, "unclear" if you cannot make it out). Report what you see, not what the item you picked should have: a mismatch between the two is exactly what the verifier needs to know.
- quantityText: the number exactly as displayed, character for character, separators included, or an empty string when no number is shown. For Silver Coin it is the inline amount; for everything else the digits overlaid on the icon. Amounts can exceed ten billion.
- quantity: the same number as plain digits with no separators (empty when none is shown). The two are compared downstream, so write quantity from the image too rather than by editing quantityText.
- gameTimestamp and character: exactly as displayed. Do not reformat the timestamp or convert time zones, and keep the name's capitalisation. Known character names, when given, are only there to settle an ambiguous glyph, never to replace a name that clearly reads differently.
- confidence: your honest probability, 0 to 1, that every field of the row is right. When it is below about 0.8, say what is doubtful in lowConfidenceReason; otherwise leave it empty.
- notes: anything the person verifying should know, such as partially visible rows, blur, or UI covering the log. Leave it empty when there is nothing to say.
- If the image is not a bank log of this kind, set looksLikeBankLog to false and return no rows.`;

const MEDIA_TYPE_BY_EXTENSION: Record<string, ImageMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** The icon root: the bare PNGs live here and the bordered references in its `ref/` subfolder. */
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
    throw new ExtractorError(
      "config",
      `Could not read reference icon "${file}" (the bordered references are drawn by \`pnpm icons:ref\`).`,
      { cause },
    );
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

/**
 * What sets an icon apart from its lookalikes, for the items the model mixes
 * up at log size (issue #19). Keyed by catalog id; ids that are not in the
 * catalog in use are simply never looked up. Part of the cached prefix.
 */
const JEWELRY = "Jewelry (ignore the paper badge in the bottom-right):";

export const ICON_HINTS: Readonly<Record<string, string>> = {
  "fragment-ring-of-night": `${JEWELRY} a wide gold ring whose band is set with several small dark-green diamond-shaped gems; no single large stone.`,
  "fragment-bracelet-of-faith": `${JEWELRY} a gold band carrying one long, bright light-green crystal bar across its top; a single big stone, much larger and lighter than the ring's gems.`,
  "fragment-necklace-of-starlight": `${JEWELRY} a gold four-pointed, sun-like amulet with a glowing round yellow-white centre, hanging from a chain; no green at all.`,
  "fragment-pirates-earring": `${JEWELRY} a silver filigree teardrop around one large round teal gem, with a small star on top; the only silver piece of the four.`,
};

export function referenceLabel(item: Pick<CatalogItem, "id" | "name" | "rarity" | "kind">): string {
  const border =
    item.kind === "currency"
      ? "no border in the log, amount printed inline"
      : `${rarityBorderWord(item.rarity)} border`;
  const label = `Reference icon — id: ${item.id}, name: ${item.name}, rarity: ${item.rarity} (${border})`;
  const hint = ICON_HINTS[item.id];
  return hint ? `${label}. ${hint}` : label;
}

export const DECOY_LABEL_PREFIX = "NOT tracked — same art, different border:";

export function decoyLabel(
  decoy: Pick<DecoyItem, "name" | "rarity" | "lookalikeOf" | "differs">,
): string {
  const lookalikes = decoy.lookalikeOf.join(" / ");
  return `${DECOY_LABEL_PREFIX} ${decoy.name} (${decoy.rarity}, ${rarityBorderWord(decoy.rarity)} border). Shares its art with ${lookalikes}: ${decoy.differs}. Answer "unknown" for it.`;
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
  /** Untracked lookalikes shown after the tracked items. May be empty. */
  decoys: readonly DecoyItem[];
  /** The icon root (`public/icons`); references are read from its `ref/` subfolder. */
  iconsDir: string;
  screenshot: { data: Uint8Array; mediaType: ImageMediaType };
  knownCharacters: readonly string[];
}

export async function buildUserContent(input: BuildContentInput): Promise<ContentBlock[]> {
  const { catalog, decoys, iconsDir, screenshot, knownCharacters } = input;
  if (catalog.length === 0) {
    throw new ExtractorError("config", "The catalog has no tracked items to match against.");
  }
  const references: { label: string; id: string }[] = [
    ...catalog.map((item) => ({ label: referenceLabel(item), id: item.id })),
    ...decoys.map((decoy) => ({ label: decoyLabel(decoy), id: decoy.id })),
  ];
  const icons = await Promise.all(
    references.map((reference) => loadIcon(referenceIconPath(iconsDir, reference.id))),
  );

  const content: ContentBlock[] = [];
  references.forEach((reference, index) => {
    content.push({ type: "text", text: reference.label });
    const icon: ImageBlock = { type: "image", source: icons[index] };
    // Cache breakpoint on the last reference icon: everything up to here is
    // identical for every upload.
    if (index === references.length - 1) icon.cache_control = { type: "ephemeral" };
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
