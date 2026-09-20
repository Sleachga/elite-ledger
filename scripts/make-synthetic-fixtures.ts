/**
 * Draws the synthetic extractor fixtures in `fixtures/extractor/`:
 * bank-log-like PNGs composed from the real icons in `public/icons/`, each
 * with its `expected.json` (deposit rows only) and `mock-response.json` (what
 * a model would plausibly return, withdrawals and display formatting
 * included). One definition feeds all three files, so they cannot drift.
 *
 *   pnpm fixtures:extractor
 *
 * The PNGs are committed: text rendering depends on the machine's fonts, and
 * the eval has to be deterministic. Re-run only to change the fixtures. These
 * approximate the game's layout from a description; real screenshots belong
 * next to them as soon as they exist.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { catalog, getItem, type CatalogItem, type Rarity } from "@/catalog";

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

// In-game rarity border colours (approximate); not the site's Radix mapping.
const RARITY_BORDER: Record<Rarity, string> = {
  common: "#9ca3af",
  uncommon: "#3ecf6e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
  mythic: "#ef4444",
};

interface LogRow {
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
function iconOf(item: CatalogItem): Promise<Image> {
  let image = iconImages.get(item.icon);
  if (!image) {
    image = loadImage(path.join(ICONS, item.icon));
    iconImages.set(item.icon, image);
  }
  return image;
}

async function drawSlot(
  ctx: SKRSContext2D,
  item: CatalogItem,
  x: number,
  y: number,
  size: number,
  overlay: string,
) {
  ctx.fillStyle = COLORS.slot;
  ctx.fillRect(x, y, size, size);

  const image = await iconOf(item);
  const inner = size - 10;
  const scale = Math.min(inner / image.width, inner / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);

  ctx.strokeStyle = RARITY_BORDER[item.rarity];
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);

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

async function drawLog(fixture: LogFixture): Promise<Buffer> {
  const width = 780;
  const headerHeight = 52;
  const rowHeight = 66;
  const height = headerHeight + fixture.rows.length * rowHeight + 14;
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
    const item = getItem(row.itemId);
    const top = headerHeight + index * rowHeight;
    const middle = top + rowHeight / 2;
    ctx.fillStyle = index % 2 === 0 ? COLORS.rowA : COLORS.rowB;
    ctx.fillRect(8, top + 2, width - 16, rowHeight - 4);

    drawArrow(ctx, 34, middle, row.direction);

    // Currency prints its amount inline in gold; everything else overlays it.
    const inline = item.kind === "currency";
    await drawSlot(ctx, item, 58, top + 8, 50, inline ? "" : row.shown);

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (inline) {
      ctx.fillStyle = COLORS.gold;
      ctx.font = `600 16px ${FONT}`;
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
      await drawSlot(ctx, getItem(filled.itemId), x, y, slot, filled.shown);
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

async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  for (const fixture of FIXTURES) {
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
        rows: fixture.rows
          .filter((row) => row.direction === "deposit")
          .map((row) => ({
            itemId: row.itemId,
            quantity: digits(row.shown),
            gameTimestamp: row.gameTimestamp,
            character: row.character,
          })),
      });
      await writeJson(path.join(dir, "mock-response.json"), {
        looksLikeBankLog: true,
        rows: fixture.rows.map((row) => ({
          itemId: row.itemId,
          iconDescription: `Synthetic fixture: drawn from the ${row.itemId} reference icon.`,
          quantity: row.shown,
          gameTimestamp: row.gameTimestamp,
          character: row.character,
          direction: row.direction,
          confidence: 0.97,
          lowConfidenceReason: "",
        })),
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
