/**
 * Draws the synthetic extractor fixtures in `fixtures/extractor/`:
 * bank-log-like PNGs composed from the real icons in `public/icons/`, each
 * with its `expected.json` (deposit rows only) and `mock-response.json` (what
 * a model would plausibly return, withdrawals and display formatting
 * included). One definition feeds all three files, so they cannot drift.
 *
 *   pnpm fixtures:extractor                    every fixture
 *   pnpm fixtures:extractor <name> [<name>]    only the named ones
 *
 * Icons get the in-game rarity border from the catalog (`rarityBorderHex`);
 * Silver Coin gets none, as in the log. Rows may use a decoy id from the
 * catalog (an untracked lookalike with a different border): those are drawn
 * with the decoy's art and border and expected as `unknown`.
 *
 * The PNGs are committed: text rendering depends on the machine's fonts, and
 * the eval has to be deterministic. Re-run only to change the fixtures. These
 * approximate the game's layout from a description; real screenshots belong
 * next to them as soon as they exist (`real-<name>/`, see the README).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import {
  catalog,
  decoys,
  rarityBorderHex,
  rarityBorderWord,
  type CatalogItem,
  type DecoyItem,
  type ItemKind,
} from "@/catalog";

const ROOT = path.join(process.cwd(), "fixtures", "extractor");
const ICONS = path.join(process.cwd(), "public", "icons");
const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

const COLORS = {
  window: "#101216",
  header: "#191c22",
  rowA: "#16191e",
  rowB: "#1b1e24",
  rule: "#262a31",
  slot: "#0b0d10",
  text: "#d5d9e0",
  muted: "#8b93a1",
  deposit: "#3ecf6e",
  withdraw: "#e5604d",
  gold: "#e8c25a",
} as const;

type Drawable = CatalogItem | DecoyItem;

const REFERENCE = new Map<string, Drawable>([...catalog, ...decoys].map((item) => [item.id, item]));
const isDecoy = (id: string): boolean => decoys.some((decoy) => decoy.id === id);

function itemOf(id: string): Drawable {
  const item = REFERENCE.get(id);
  if (!item) throw new Error(`fixtures: unknown item id "${id}"`);
  return item;
}

/** Decoys are materials for drawing purposes: overlay number, rarity border. */
const kindOf = (item: Drawable): ItemKind => ("kind" in item ? item.kind : "material");

interface LogRow {
  /** A tracked item id or a decoy id. */
  itemId: string;
  /** As displayed: "112", "500,000,000", or "" for no overlay (a stack of 1). */
  shown: string;
  gameTimestamp: string;
  character: string;
  direction: "deposit" | "withdraw";
}

interface LogFixture {
  name: string;
  kind: "log";
  rows: LogRow[];
  /**
   * Icon slot edge in px. The game draws log icons at about 48px, which is
   * what makes the fragments hard to tell apart; the first fixtures used 50.
   */
  slot?: number;
  /** Font size of the inline Silver Coin amount. The game prints it small; the first fixtures used 16. */
  amountPx?: number;
  /**
   * Write the mock response without `quantityText` / `box` / `borderColor`,
   * the way the model answered before those fields existed, so `--mock`
   * keeps exercising the lenient parse of older responses.
   */
  legacyMock?: boolean;
}

interface InventoryFixture {
  name: string;
  kind: "inventory";
  slots: { itemId: string; shown: string }[];
}

const dep = (itemId: string, shown: string, gameTimestamp: string, character: string): LogRow => ({
  itemId,
  shown,
  gameTimestamp,
  character,
  direction: "deposit",
});

const FIXTURES: (LogFixture | InventoryFixture)[] = [
  {
    // Identical single-Nyxium rows (no overlay -> 1) next to stacked rows.
    name: "synthetic-mixed-stacks",
    kind: "log",
    legacyMock: true,
    rows: [
      dep("nyxium", "", "06.09.2026 - 23:21", "Leftaltar"),
      dep("nyxium", "", "06.09.2026 - 23:21", "Leftaltar"),
      dep("nyxium", "", "06.09.2026 - 23:21", "Leftaltar"),
      dep("nyxium", "", "06.09.2026 - 23:20", "Leftaltar"),
      dep("gold-ingot", "112", "06.09.2026 - 23:19", "Leftaltar"),
      dep("mithrilium", "100", "06.09.2026 - 23:18", "Leftaltar"),
      dep("obsidian", "1000", "06.09.2026 - 23:18", "Leftaltar"),
      dep("ruby", "37", "06.09.2026 - 23:17", "Leftaltar"),
      dep("purified-veltryn", "250", "06.09.2026 - 23:15", "Leftaltar"),
      dep("fragment-ring-of-night", "4", "06.09.2026 - 23:14", "Leftaltar"),
    ],
  },
  {
    // Silver printed inline (incl. a value past 2^31) and a withdrawal to drop.
    name: "synthetic-silver-and-withdraw",
    kind: "log",
    legacyMock: true,
    rows: [
      dep("silver-coin", "500,000,000", "07.09.2026 - 18:02", "xReacher"),
      dep("cobalt-ingot", "2000", "07.09.2026 - 18:01", "xReacher"),
      {
        itemId: "iron-ingot",
        shown: "1000",
        gameTimestamp: "07.09.2026 - 17:58",
        character: "Leftaltar",
        direction: "withdraw",
      },
      dep("silver-coin", "10,000,000,000", "07.09.2026 - 17:55", "xReacher"),
      dep("copper-ingot", "640", "07.09.2026 - 17:40", "Leftaltar"),
    ],
  },
  {
    // Every tracked item once, to measure item identification across the catalog.
    name: "synthetic-all-items",
    kind: "log",
    legacyMock: true,
    rows: catalog.map((item, index) =>
      dep(
        item.id,
        item.kind === "currency" ? "1,250,000" : String(3 + index * 7),
        `09.09.2026 - 20:${String(59 - index * 2).padStart(2, "0")}`,
        index % 2 === 0 ? "Leftaltar" : "xReacher",
      ),
    ),
  },
  {
    // Issue #19: the four blueprint fragments share a paper badge and differ
    // only in a ~30px piece of jewelry. Three rows of each, shuffled, small
    // stacks (the overlay sits on the badge corner), next to two materials in
    // the same gold / red palette. Icons at the in-game 48px.
    name: "synthetic-fragments-heavy",
    kind: "log",
    slot: 48,
    rows: [
      dep("fragment-ring-of-night", "2", "12.09.2026 - 21:48", "Leftaltar"),
      dep("fragment-necklace-of-starlight", "", "12.09.2026 - 21:47", "Leftaltar"),
      dep("gold-ingot", "12", "12.09.2026 - 21:47", "Leftaltar"),
      dep("fragment-pirates-earring", "5", "12.09.2026 - 21:45", "xReacher"),
      dep("fragment-bracelet-of-faith", "12", "12.09.2026 - 21:44", "xReacher"),
      dep("fragment-necklace-of-starlight", "5", "12.09.2026 - 21:40", "Leftaltar"),
      dep("fragment-ring-of-night", "", "12.09.2026 - 21:39", "xReacher"),
      dep("fragment-bracelet-of-faith", "2", "12.09.2026 - 21:36", "Leftaltar"),
      dep("ruby", "5", "12.09.2026 - 21:35", "Leftaltar"),
      dep("fragment-pirates-earring", "", "12.09.2026 - 21:33", "Leftaltar"),
      dep("fragment-ring-of-night", "12", "12.09.2026 - 21:31", "Leftaltar"),
      dep("fragment-bracelet-of-faith", "", "12.09.2026 - 21:30", "xReacher"),
      dep("fragment-necklace-of-starlight", "2", "12.09.2026 - 21:28", "xReacher"),
      dep("fragment-pirates-earring", "12", "12.09.2026 - 21:27", "Leftaltar"),
    ],
  },
  {
    // Issue #19: silver amounts go wrong by a digit group or a digit. Six
    // magnitudes from 5 million to 10 billion, between two ingot rows whose
    // overlay numbers must not be mistaken for inline amounts.
    name: "synthetic-money-heavy",
    kind: "log",
    slot: 48,
    amountPx: 12,
    rows: [
      dep("silver-coin", "5,000,000", "13.09.2026 - 19:22", "Leftaltar"),
      dep("silver-coin", "50,000,000", "13.09.2026 - 19:21", "Leftaltar"),
      dep("iron-ingot", "5000", "13.09.2026 - 19:20", "Leftaltar"),
      dep("silver-coin", "500,000,000", "13.09.2026 - 19:18", "xReacher"),
      dep("silver-coin", "1,250,000,000", "13.09.2026 - 19:15", "xReacher"),
      dep("silver-ingot", "500", "13.09.2026 - 19:14", "Leftaltar"),
      dep("silver-coin", "10,000,000,000", "13.09.2026 - 19:11", "Leftaltar"),
      dep("silver-coin", "75,500,000", "13.09.2026 - 19:09", "xReacher"),
    ],
  },
  {
    // Rarity is part of identity: the same art with a different border is a
    // different item. Tracked rows with their real borders next to decoys
    // that share the art (Bright / Faded Veltryn beside Purified Veltryn,
    // Adamantite Ingot beside Mithrilium), all expected as `unknown`.
    name: "synthetic-rarity-decoys",
    kind: "log",
    slot: 48,
    rows: [
      dep("purified-veltryn", "250", "15.09.2026 - 22:31", "Leftaltar"),
      dep("bright-veltryn", "300", "15.09.2026 - 22:30", "Leftaltar"),
      dep("nyxium", "", "15.09.2026 - 22:29", "xReacher"),
      dep("faded-veltryn", "120", "15.09.2026 - 22:27", "Leftaltar"),
      dep("mithrilium", "100", "15.09.2026 - 22:26", "xReacher"),
      dep("adamantite-ingot", "500", "15.09.2026 - 22:24", "xReacher"),
      dep("gold-ingot", "112", "15.09.2026 - 22:22", "Leftaltar"),
      dep("fragment-necklace-of-starlight", "3", "15.09.2026 - 22:20", "Leftaltar"),
      dep("silver-coin", "250,000,000", "15.09.2026 - 22:18", "xReacher"),
      dep("iron-ingot", "1000", "15.09.2026 - 22:15", "Leftaltar"),
      dep("bright-veltryn", "40", "15.09.2026 - 22:13", "xReacher"),
      dep("obsidian", "800", "15.09.2026 - 22:11", "Leftaltar"),
    ],
  },
  {
    // A wrong upload: an inventory window, not the bank log.
    name: "synthetic-not-a-bank-log",
    kind: "inventory",
    slots: [
      { itemId: "gold-ingot", shown: "48" },
      { itemId: "ruby", shown: "12" },
      { itemId: "obsidian", shown: "305" },
      { itemId: "nyxium", shown: "" },
      { itemId: "iron-ingot", shown: "999" },
      { itemId: "fragment-pirates-earring", shown: "2" },
      { itemId: "purified-veltryn", shown: "20" },
    ],
  },
];

const iconImages = new Map<string, Promise<Image>>();
function iconOf(item: Drawable): Promise<Image> {
  let image = iconImages.get(item.icon);
  if (!image) {
    image = loadImage(path.join(ICONS, item.icon));
    iconImages.set(item.icon, image);
  }
  return image;
}

async function drawSlot(
  ctx: SKRSContext2D,
  item: Drawable,
  x: number,
  y: number,
  size: number,
  overlay: string,
  pad = 5,
) {
  ctx.fillStyle = COLORS.slot;
  ctx.fillRect(x, y, size, size);

  const image = await iconOf(item);
  const inner = size - 2 * pad;
  const scale = Math.min(inner / image.width, inner / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);

  // The in-game border; Silver Coin has none.
  if (kindOf(item) !== "currency") {
    ctx.strokeStyle = rarityBorderHex[item.rarity];
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
  }

  if (overlay !== "") {
    ctx.font = `bold 13px ${FONT}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000000";
    ctx.strokeText(overlay, x + size - 4, y + size - 5);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(overlay, x + size - 4, y + size - 5);
  }
}

function drawArrow(ctx: SKRSContext2D, cx: number, cy: number, direction: LogRow["direction"]) {
  const up = direction === "deposit";
  ctx.fillStyle = up ? COLORS.deposit : COLORS.withdraw;
  ctx.beginPath();
  ctx.moveTo(cx, cy + (up ? -8 : 8));
  ctx.lineTo(cx + 8, cy + (up ? 6 : -6));
  ctx.lineTo(cx - 8, cy + (up ? 6 : -6));
  ctx.closePath();
  ctx.fill();
}

const LOG = { width: 780, headerHeight: 52, rowHeight: 66, footer: 14 } as const;

function logHeight(fixture: LogFixture): number {
  return LOG.headerHeight + fixture.rows.length * LOG.rowHeight + LOG.footer;
}

/** A row's vertical extent as fractions of the image height: what the model is asked for as `box`. */
function rowBox(fixture: LogFixture, index: number): { top: number; bottom: number } {
  const height = logHeight(fixture);
  const top = LOG.headerHeight + index * LOG.rowHeight;
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return { top: round(top / height), bottom: round((top + LOG.rowHeight) / height) };
}

async function drawLog(fixture: LogFixture): Promise<Buffer> {
  const { width, headerHeight, rowHeight } = LOG;
  const height = logHeight(fixture);
  const slot = fixture.slot ?? 50;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = COLORS.window;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.header;
  ctx.fillRect(0, 0, width, headerHeight);
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 18px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Guild Bank", 20, headerHeight / 2);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `14px ${FONT}`;
  ctx.fillText("Log", 124, headerHeight / 2 + 1);

  for (const [index, row] of fixture.rows.entries()) {
    const item = itemOf(row.itemId);
    const top = headerHeight + index * rowHeight;
    const middle = top + rowHeight / 2;
    ctx.fillStyle = index % 2 === 0 ? COLORS.rowA : COLORS.rowB;
    ctx.fillRect(8, top + 2, width - 16, rowHeight - 4);

    drawArrow(ctx, 34, middle, row.direction);

    // Currency prints its amount inline in gold; everything else overlays it.
    const inline = kindOf(item) === "currency";
    // 50px slots keep the first fixtures' 5px art padding; 48px ones fill the slot like the game.
    await drawSlot(
      ctx,
      item,
      58,
      top + (rowHeight - slot) / 2,
      slot,
      inline ? "" : row.shown,
      fixture.slot === undefined ? 5 : 3,
    );

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (inline) {
      ctx.fillStyle = COLORS.gold;
      ctx.font =
        fixture.amountPx === undefined ? `600 16px ${FONT}` : `${fixture.amountPx}px ${FONT}`;
      ctx.fillText(row.shown, 120, middle);
    }

    ctx.fillStyle = row.direction === "deposit" ? COLORS.deposit : COLORS.withdraw;
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(row.direction === "deposit" ? "Deposit" : "Withdraw", 286, middle);

    ctx.fillStyle = COLORS.muted;
    ctx.font = `15px ${FONT}`;
    ctx.fillText(row.gameTimestamp, 396, middle);

    ctx.fillStyle = COLORS.text;
    ctx.font = `16px ${FONT}`;
    ctx.fillText(row.character, 590, middle);
  }
  return canvas.toBuffer("image/png");
}

async function drawInventory(fixture: InventoryFixture): Promise<Buffer> {
  const columns = 6;
  const rows = 4;
  const slot = 72;
  const gap = 8;
  const headerHeight = 52;
  const width = 24 * 2 + columns * slot + (columns - 1) * gap;
  const height = headerHeight + 16 + rows * slot + (rows - 1) * gap + 56;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = COLORS.window;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.header;
  ctx.fillRect(0, 0, width, headerHeight);
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 18px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Inventory", 20, headerHeight / 2);

  for (let index = 0; index < columns * rows; index += 1) {
    const x = 24 + (index % columns) * (slot + gap);
    const y = headerHeight + 16 + Math.floor(index / columns) * (slot + gap);
    const filled = fixture.slots[index];
    if (filled) {
      await drawSlot(ctx, itemOf(filled.itemId), x, y, slot, filled.shown);
    } else {
      ctx.fillStyle = COLORS.slot;
      ctx.fillRect(x, y, slot, slot);
      ctx.strokeStyle = COLORS.rule;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, slot - 1, slot - 1);
    }
  }

  ctx.fillStyle = COLORS.muted;
  ctx.font = `14px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText(`Slots ${fixture.slots.length} / ${columns * rows}`, 24, height - 28);
  ctx.textAlign = "right";
  ctx.fillText("Weight 184.5 / 400", width - 24, height - 28);
  return canvas.toBuffer("image/png");
}

const digits = (shown: string) => (shown === "" ? "1" : shown.replace(/\D/g, ""));

/** The model's answer for a row: what a decoy row is, and what border it saw. */
function mockRow(fixture: LogFixture, row: LogRow, index: number) {
  const item = itemOf(row.itemId);
  const decoy = isDecoy(row.itemId);
  const currency = kindOf(item) === "currency";
  const border = currency
    ? { borderColorWord: "", borderColor: "none" }
    : { borderColorWord: rarityBorderWord(item.rarity), borderColor: item.rarity };
  return {
    itemId: decoy ? "unknown" : row.itemId,
    iconDescription: decoy
      ? `Synthetic fixture: drawn from the ${item.name} icon (${item.rarity}, ${border.borderColorWord} border), which is not a tracked item.`
      : `Synthetic fixture: drawn from the ${row.itemId} reference icon.`,
    quantity: row.shown,
    ...(fixture.legacyMock ? {} : { quantityText: row.shown, box: rowBox(fixture, index), ...border }),
    gameTimestamp: row.gameTimestamp,
    character: row.character,
    direction: row.direction,
    confidence: 0.97,
    lowConfidenceReason: "",
  };
}

async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const only = process.argv.slice(2);
  const unknown = only.filter((name) => !FIXTURES.some((fixture) => fixture.name === name));
  if (unknown.length > 0) throw new Error(`no such fixture: ${unknown.join(", ")}`);

  for (const fixture of FIXTURES) {
    if (only.length > 0 && !only.includes(fixture.name)) continue;
    const dir = path.join(ROOT, fixture.name);
    await mkdir(dir, { recursive: true });

    if (fixture.kind === "inventory") {
      await writeFile(path.join(dir, "screenshot.png"), await drawInventory(fixture));
      await writeJson(path.join(dir, "expected.json"), { looksLikeBankLog: false, rows: [] });
      await writeJson(path.join(dir, "mock-response.json"), {
        looksLikeBankLog: false,
        rows: [],
        notes: ["This is an inventory grid, not the guild bank log."],
      });
    } else {
      await writeFile(path.join(dir, "screenshot.png"), await drawLog(fixture));
      await writeJson(path.join(dir, "expected.json"), {
        looksLikeBankLog: true,
        rows: fixture.rows.flatMap((row, index) =>
          row.direction === "deposit"
            ? [
                {
                  itemId: isDecoy(row.itemId) ? "unknown" : row.itemId,
                  quantity: digits(row.shown),
                  gameTimestamp: row.gameTimestamp,
                  character: row.character,
                  ...(isDecoy(row.itemId) ? { decoy: row.itemId } : {}),
                  ...(fixture.legacyMock ? {} : { box: rowBox(fixture, index) }),
                },
              ]
            : [],
        ),
      });
      await writeJson(path.join(dir, "mock-response.json"), {
        looksLikeBankLog: true,
        rows: fixture.rows.map((row, index) => mockRow(fixture, row, index)),
        notes: [],
      });
    }
    console.log(`fixtures: wrote ${path.relative(process.cwd(), dir)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
