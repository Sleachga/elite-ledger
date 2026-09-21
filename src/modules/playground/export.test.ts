import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFixture, buildTsv, exportItemName, fixtureFileName, fixtureJson, tsvCell } from "./export";
import type { RowValues } from "./review";

function values(itemId: string, quantity: string, overrides: Partial<RowValues> = {}): RowValues {
  return { itemId, quantity, gameTimestamp: "07.09.2026 - 18:02", character: "xReacher", ...overrides };
}

describe("buildTsv", () => {
  it("writes a header and one line per row: time, character, item name, plain digits, file name", () => {
    const tsv = buildTsv([
      {
        fileName: "log-1.png",
        rows: [values("silver-coin", "500000000"), values("cobalt-ingot", "2000", { character: "Leftaltar" })],
      },
      { fileName: "log-2.png", rows: [values("fragment-ring-of-night", "3")] },
    ]);
    expect(tsv.split("\n")).toEqual([
      "Game time\tCharacter\tItem\tQuantity\tImage",
      "07.09.2026 - 18:02\txReacher\tSilver Coin\t500000000\tlog-1.png",
      "07.09.2026 - 18:02\tLeftaltar\tCobalt Ingot\t2000\tlog-1.png",
      "07.09.2026 - 18:02\txReacher\t[Blueprint Fragment] Ring of Night\t3\tlog-2.png",
    ]);
  });

  it("can leave the header out", () => {
    expect(buildTsv([{ fileName: "a.png", rows: [values("ruby", "5")] }], { header: false })).toBe(
      "07.09.2026 - 18:02\txReacher\tRuby\t5\ta.png",
    );
  });

  it("keeps huge quantities as exact digits", () => {
    const tsv = buildTsv([{ fileName: "a.png", rows: [values("silver-coin", "9007199254740993")] }], {
      header: false,
    });
    expect(tsv.split("\t")[3]).toBe("9007199254740993");
  });

  it("names untracked items Unknown and pasted images Pasted image", () => {
    expect(exportItemName("unknown")).toBe("Unknown");
    expect(exportItemName("dragon-scale")).toBe("Unknown");
    const tsv = buildTsv([{ fileName: "", rows: [values("unknown", "7")] }], { header: false });
    expect(tsv).toBe("07.09.2026 - 18:02\txReacher\tUnknown\t7\tPasted image");
  });

  it("is only the header for a batch without rows", () => {
    expect(buildTsv([])).toBe("Game time\tCharacter\tItem\tQuantity\tImage");
    expect(buildTsv([{ fileName: "a.png", rows: [] }], { header: false })).toBe("");
  });

  it("keeps tabs, line breaks and formulas out of cells", () => {
    expect(tsvCell("a\tb\r\nc")).toBe("a b c");
    expect(tsvCell("  xReacher ")).toBe("xReacher");
    expect(tsvCell("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(tsvCell("+1")).toBe("'+1");
    expect(tsvCell("-Reaper-")).toBe("'-Reaper-");
    expect(tsvCell("@name")).toBe("'@name");
    const tsv = buildTsv([{ fileName: "=evil.png", rows: [values("ruby", "5", { character: "Tab\tby" })] }], {
      header: false,
    });
    expect(tsv.split("\t")).toEqual(["07.09.2026 - 18:02", "Tab by", "Ruby", "5", "'=evil.png"]);
  });
});

describe("buildFixture", () => {
  it("has exactly the shape of fixtures/extractor/*/expected.json", () => {
    const fixture = buildFixture(true, [
      // Extra fields on a row never leak into the file.
      { ...values("silver-coin", "500000000"), confidence: 0.9 } as RowValues,
      values("copper-ingot", "640", { gameTimestamp: "07.09.2026 - 17:40", character: "Leftaltar" }),
    ]);
    expect(fixture).toEqual({
      looksLikeBankLog: true,
      rows: [
        { itemId: "silver-coin", quantity: "500000000", gameTimestamp: "07.09.2026 - 18:02", character: "xReacher" },
        { itemId: "copper-ingot", quantity: "640", gameTimestamp: "07.09.2026 - 17:40", character: "Leftaltar" },
      ],
    });
    expect(Object.keys(fixture)).toEqual(["looksLikeBankLog", "rows"]);
    expect(Object.keys(fixture.rows[0])).toEqual(["itemId", "quantity", "gameTimestamp", "character"]);
  });

  it("has no rows when the image is not a bank log", () => {
    expect(buildFixture(false, [values("ruby", "5")])).toEqual({ looksLikeBankLog: false, rows: [] });
  });

  it("writes two-space JSON with a trailing newline, like the vendored files", () => {
    expect(fixtureJson(buildFixture(true, [values("ruby", "5")]))).toBe(
      [
        "{",
        '  "looksLikeBankLog": true,',
        '  "rows": [',
        "    {",
        '      "itemId": "ruby",',
        '      "quantity": "5",',
        '      "gameTimestamp": "07.09.2026 - 18:02",',
        '      "character": "xReacher"',
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("rebuilds every vendored fixture from its own rows", () => {
    const root = join(process.cwd(), "fixtures", "extractor");
    const names = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(names.length).toBeGreaterThan(0);
    for (const { name } of names) {
      const parsed = JSON.parse(readFileSync(join(root, name, "expected.json"), "utf8")) as {
        looksLikeBankLog: boolean;
        rows: RowValues[];
      };
      const rebuilt = buildFixture(parsed.looksLikeBankLog, parsed.rows);
      // Each file may grow fields this builder does not know; the four it writes must match.
      expect(parsed, name).toMatchObject(rebuilt);
      expect(rebuilt.rows, name).toHaveLength(parsed.rows.length);
    }
  });
});

describe("fixtureFileName", () => {
  it("is a safe slug of the screenshot's name", () => {
    expect(fixtureFileName("Bank Log 07.09 (2).png")).toBe("bank-log-07-09-2.expected.json");
    expect(fixtureFileName("shot.JPEG")).toBe("shot.expected.json");
    expect(fixtureFileName("")).toBe("screenshot.expected.json");
    expect(fixtureFileName("???.png")).toBe("screenshot.expected.json");
  });
});
