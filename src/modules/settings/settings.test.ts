import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db, type DbHandle } from "@/db";
import { settings as settingsTable } from "@/db/schema";
import {
  DEFAULT_SETTINGS,
  SETTINGS_CACHE_TTL_MS,
  getSettings,
  getSettingsInfo,
  invalidateSettingsCache,
  updateSettings,
  type SettingsPatch,
} from "./index";

// In-memory PGlite with the committed migrations: the real table, no mocks.
describe("settings module", () => {
  let handle: DbHandle;
  let db: Db;

  beforeAll(async () => {
    handle = await createDb({ memory: true });
    await handle.migrate();
    db = handle.db;
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  beforeEach(async () => {
    await db.delete(settingsTable);
    invalidateSettingsCache();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Write a row behind the module's back. */
  async function store(key: string, value: unknown) {
    await db
      .insert(settingsTable)
      .values({ key, value, updatedBy: "test" })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value } });
  }

  it("returns the defaults when no rows exist: AI on, default mode AI", async () => {
    expect(await getSettings(db)).toEqual({ aiExtractionEnabled: true, defaultUploadMode: "ai" });
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    expect((await getSettingsInfo(db)).lastChange).toBeNull();
  });

  it("round-trips an update and records who made it", async () => {
    const saved = await updateSettings(
      { aiExtractionEnabled: false, defaultUploadMode: "manual" },
      { updatedBy: "  Sandy  ", db },
    );
    expect(saved.settings).toEqual({ aiExtractionEnabled: false, defaultUploadMode: "manual" });
    expect(await getSettings(db)).toEqual({ aiExtractionEnabled: false, defaultUploadMode: "manual" });

    const info = await getSettingsInfo(db);
    expect(info.lastChange?.by).toBe("Sandy");
    expect(info.lastChange?.at).toBeInstanceOf(Date);

    const rows = await db.select().from(settingsTable);
    expect(rows.map((row) => row.key).sort()).toEqual(["aiExtractionEnabled", "defaultUploadMode"]);
    expect(rows.every((row) => row.updatedBy === "Sandy")).toBe(true);
  });

  it("a partial patch touches only its own key", async () => {
    await updateSettings({ defaultUploadMode: "manual" }, { updatedBy: "A", db });
    await updateSettings({ aiExtractionEnabled: false }, { updatedBy: "B", db });
    expect(await getSettings(db)).toEqual({ aiExtractionEnabled: false, defaultUploadMode: "manual" });

    const rows = await db.select().from(settingsTable);
    expect(rows.find((row) => row.key === "defaultUploadMode")?.updatedBy).toBe("A");
    expect(rows.find((row) => row.key === "aiExtractionEnabled")?.updatedBy).toBe("B");

    // Saving the same key again updates it in place.
    await updateSettings({ aiExtractionEnabled: true }, { updatedBy: "C", db });
    expect(await getSettings(db)).toEqual({ aiExtractionEnabled: true, defaultUploadMode: "manual" });
    expect(await db.select().from(settingsTable)).toHaveLength(2);
  });

  it("an empty patch writes nothing", async () => {
    await updateSettings({}, { updatedBy: "A", db });
    expect(await db.select().from(settingsTable)).toHaveLength(0);
  });

  it("rejects unknown keys and wrong types without writing", async () => {
    await expect(updateSettings({ nope: true } as SettingsPatch, { updatedBy: "A", db })).rejects.toThrow();
    await expect(
      updateSettings({ aiExtractionEnabled: "yes" } as unknown as SettingsPatch, { updatedBy: "A", db }),
    ).rejects.toThrow();
    await expect(
      updateSettings({ defaultUploadMode: "auto" } as unknown as SettingsPatch, { updatedBy: "A", db }),
    ).rejects.toThrow();
    expect(await db.select().from(settingsTable)).toHaveLength(0);
  });

  it("falls back per key on a malformed stored value, and logs it once", async () => {
    await store("aiExtractionEnabled", "definitely");
    await store("defaultUploadMode", "manual");
    await store("someFutureSetting", { anything: [1, 2, 3] });

    expect(await getSettings(db)).toEqual({ aiExtractionEnabled: true, defaultUploadMode: "manual" });
    expect(console.warn).toHaveBeenCalledTimes(1);

    // Read again past the cache: same answer, no second log line.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + SETTINGS_CACHE_TTL_MS + 1);
    expect(await getSettings(db)).toEqual({ aiExtractionEnabled: true, defaultUploadMode: "manual" });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("survives every kind of JSON in a value", async () => {
    // (SQL NULL cannot be stored: the column is NOT NULL.)
    for (const value of [0, 1, "", "AI", [], {}, { enabled: true }]) {
      await store("aiExtractionEnabled", value);
      await store("defaultUploadMode", value);
      invalidateSettingsCache();
      expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("never throws when the database cannot be read", async () => {
    const broken = {
      select: () => {
        throw new Error("relation \"settings\" does not exist");
      },
    } as unknown as Db;
    expect(await getSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(await getSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  describe("cache", () => {
    it("serves a read from memory until the TTL passes", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const start = Date.now();
      expect((await getSettings(db)).aiExtractionEnabled).toBe(true);

      await store("aiExtractionEnabled", false); // behind the module's back
      vi.setSystemTime(start + SETTINGS_CACHE_TTL_MS - 1);
      expect((await getSettings(db)).aiExtractionEnabled).toBe(true);

      vi.setSystemTime(start + SETTINGS_CACHE_TTL_MS + 1);
      expect((await getSettings(db)).aiExtractionEnabled).toBe(false);
    });

    it("is dropped by invalidateSettingsCache", async () => {
      expect((await getSettings(db)).defaultUploadMode).toBe("ai");
      await store("defaultUploadMode", "manual");
      expect((await getSettings(db)).defaultUploadMode).toBe("ai");
      invalidateSettingsCache();
      expect((await getSettings(db)).defaultUploadMode).toBe("manual");
    });

    it("is dropped by updateSettings, so a saved change shows at once", async () => {
      expect((await getSettings(db)).aiExtractionEnabled).toBe(true);
      await updateSettings({ aiExtractionEnabled: false }, { updatedBy: "A", db });
      expect((await getSettings(db)).aiExtractionEnabled).toBe(false);
    });

    it("keeps one cache per database", async () => {
      const other = await createDb({ memory: true });
      try {
        await other.migrate();
        await updateSettings({ defaultUploadMode: "manual" }, { updatedBy: "A", db: other.db });
        expect((await getSettings(other.db)).defaultUploadMode).toBe("manual");
        expect((await getSettings(db)).defaultUploadMode).toBe("ai");
      } finally {
        await other.close();
      }
    }, 60_000);
  });
});
