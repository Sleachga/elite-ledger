/**
 * Draws the extractor's reference icons, `public/icons/ref/<id>.png`: every
 * tracked item and every decoy from the catalog, composited on a dark slot
 * with its in-game rarity border (`rarityBorderHex`), at 96px. Silver Coin
 * gets no border, as in the log.
 *
 *   pnpm icons:ref
 *
 * Re-run after changing an icon, a rarity, the border palette or the decoy
 * list. The PNGs are committed; `reference-icons.test.ts` checks that they
 * exist and carry the right border.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { catalog, decoys, rarityBorderHex } from "@/catalog";
import {
  REFERENCE_ICON_DIR,
  compositeReferenceIcon,
  referenceIconPath,
} from "@/modules/extractor/reference-icons";

const ICONS = path.join(process.cwd(), "public", "icons");

async function main() {
  await mkdir(path.join(ICONS, REFERENCE_ICON_DIR), { recursive: true });
  for (const item of [...catalog, ...decoys]) {
    const currency = "kind" in item && item.kind === "currency";
    const border = currency ? undefined : rarityBorderHex[item.rarity];
    const art = await readFile(path.join(ICONS, item.icon));
    const out = referenceIconPath(ICONS, item.id);
    await writeFile(out, await compositeReferenceIcon(art, border));
    console.log(
      `icons: wrote ${path.relative(process.cwd(), out)} (${item.rarity}${border ? ` ${border}` : ", no border"})`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
