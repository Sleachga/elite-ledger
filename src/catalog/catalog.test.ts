import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RARITIES,
  RARITY_BORDER,
  catalog,
  decoys,
  findDecoy,
  findItem,
  rarityBorderHex,
  rarityBorderWord,
  sameBorderColor,
} from "./index";

const ICONS = path.join(process.cwd(), "public", "icons");

describe("in-game rarity borders", () => {
  it("gives every rarity a hex color and a color word", () => {
    for (const rarity of RARITIES) {
      expect(rarityBorderHex[rarity]).toMatch(/^#[0-9a-f]{6}$/);
      expect(rarityBorderWord(rarity)).toMatch(/^[a-z]+$/);
      expect(RARITY_BORDER[rarity].evidence).toBeTruthy();
    }
  });

  it("matches what the owner's screenshots showed", () => {
    // Ingots green, Nyxium purple, blueprint fragments red.
    expect(rarityBorderWord("common")).toBe("green");
    expect(rarityBorderWord("legendary")).toBe("purple");
    expect(rarityBorderWord("mythic")).toBe("red");
    expect(rarityBorderWord("rare")).toBe("purple"); // the owner's word for Purified Veltryn
  });

  it("treats rarities that share a color word as the same border", () => {
    expect(sameBorderColor("rare", "legendary")).toBe(true);
    expect(sameBorderColor("common", "rare")).toBe(false);
    expect(sameBorderColor("mythic", "mythic")).toBe(true);
    // Same word, same hex: the reference icons look alike too.
    expect(rarityBorderHex.rare).toBe(rarityBorderHex.legendary);
  });
});

describe("decoys", () => {
  it("include the two other Veltryns at least", () => {
    expect(findDecoy("faded-veltryn")).toMatchObject({ rarity: "common", lookalikeOf: ["purified-veltryn"] });
    expect(findDecoy("bright-veltryn")).toMatchObject({ rarity: "uncommon", lookalikeOf: ["purified-veltryn"] });
    expect(decoys.length).toBeGreaterThanOrEqual(2);
  });

  it("have unique ids that are not tracked items", () => {
    const ids = decoys.map((decoy) => decoy.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(findItem(id)).toBeUndefined();
  });

  it("each name at least one tracked item they look like, with a different border", () => {
    for (const decoy of decoys) {
      expect(decoy.lookalikeOf.length).toBeGreaterThan(0);
      for (const id of decoy.lookalikeOf) {
        const tracked = findItem(id);
        expect(tracked, `${decoy.id} looks like unknown item ${id}`).toBeDefined();
        expect(sameBorderColor(decoy.rarity, tracked!.rarity), `${decoy.id} vs ${id}`).toBe(false);
      }
      expect(decoy.differs.length).toBeGreaterThan(10);
    }
  });

  it("have their bare icon vendored in public/icons like the tracked items", () => {
    for (const item of [...catalog, ...decoys]) {
      expect(existsSync(path.join(ICONS, item.icon)), item.icon).toBe(true);
    }
  });
});
