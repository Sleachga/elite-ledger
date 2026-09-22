/**
 * Admin settings: typed values over the `settings` table (key -> JSON).
 *
 *   getSettings()                         -> every setting, defaults filled in
 *   updateSettings(patch, { updatedBy })  -> upsert the known keys of `patch`
 *
 * Reading never throws: a missing row, a stored value of the wrong shape, or a
 * database that cannot be reached all come back as that key's default (logged
 * once), so a bad row can never take the upload screen down. Reads are cached
 * in-process for `SETTINGS_CACHE_TTL_MS`; `updateSettings` drops the cache, so
 * the instance that saved sees the change at once and the others within the
 * TTL. Writing does throw: the admin page must hear that a save failed.
 *
 * Server-only (imports the db module). Browser code imports the types alone.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db";
import { settings as settingsTable } from "@/db/schema";

export const UPLOAD_MODES = ["manual", "ai"] as const;
export type UploadMode = (typeof UPLOAD_MODES)[number];

export interface Settings {
  /** Off: the AI option disappears from the upload screen and the extract endpoint refuses. */
  aiExtractionEnabled: boolean;
  /** The mode a member starts in until they pick one themselves. */
  defaultUploadMode: UploadMode;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  aiExtractionEnabled: true,
  defaultUploadMode: "ai",
};

/** One schema per key: a bad value costs only its own key. New settings are added here. */
const VALUE_SCHEMAS = {
  aiExtractionEnabled: z.boolean(),
  defaultUploadMode: z.enum(UPLOAD_MODES),
} satisfies { [K in keyof Settings]: z.ZodType<Settings[K]> };

const KEYS = Object.keys(VALUE_SCHEMAS) as (keyof Settings)[];

/** A patch: any subset of the known keys, correctly typed, nothing else. */
export const settingsPatchSchema = z.strictObject({
  aiExtractionEnabled: VALUE_SCHEMAS.aiExtractionEnabled.optional(),
  defaultUploadMode: VALUE_SCHEMAS.defaultUploadMode.optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const MAX_UPDATED_BY_LENGTH = 80;

export interface SettingsChange {
  at: Date;
  by: string | null;
}

export interface SettingsInfo {
  settings: Settings;
  /** The most recent change to any known key; null while nothing was ever saved. */
  lastChange: SettingsChange | null;
}

export const SETTINGS_CACHE_TTL_MS = 15_000;

interface CacheEntry {
  at: number;
  info: SettingsInfo;
}

/** Per database handle, so tests with their own in-memory databases never share a cache. */
let cache = new WeakMap<Db, CacheEntry>();
const logged = new Set<string>();

function logOnce(id: string, message: string, detail?: unknown): void {
  if (logged.has(id)) return;
  logged.add(id);
  if (detail === undefined) console.warn(`[settings] ${message}`);
  else console.warn(`[settings] ${message}`, detail);
}

/** Forget every cached read (and which problems were already logged). */
export function invalidateSettingsCache(): void {
  cache = new WeakMap();
  logged.clear();
}

function readValue<K extends keyof Settings>(key: K, stored: unknown): Settings[K] {
  const schema: z.ZodType<Settings[keyof Settings]> = VALUE_SCHEMAS[key];
  const parsed = (schema as z.ZodType<Settings[K]>).safeParse(stored);
  if (parsed.success) return parsed.data;
  logOnce(
    `value:${key}`,
    `stored value for "${key}" is not valid (${JSON.stringify(stored)}); using the default ${JSON.stringify(DEFAULT_SETTINGS[key])}.`,
  );
  return DEFAULT_SETTINGS[key];
}

async function load(db: Db): Promise<SettingsInfo> {
  const rows = await db.select().from(settingsTable);
  const values: Settings = { ...DEFAULT_SETTINGS };
  let lastChange: SettingsChange | null = null;
  const assign = <K extends keyof Settings>(key: K, stored: unknown) => {
    values[key] = readValue(key, stored);
  };
  for (const row of rows) {
    const key = KEYS.find((known) => known === row.key);
    if (!key) continue; // a key from a newer (or older) version of the app
    assign(key, row.value);
    if (!lastChange || row.updatedAt > lastChange.at) lastChange = { at: row.updatedAt, by: row.updatedBy };
  }
  return { settings: values, lastChange };
}

/** Settings plus who changed them last. Same cache and the same never-throws rule as `getSettings`. */
export async function getSettingsInfo(db?: Db): Promise<SettingsInfo> {
  let handle: Db;
  try {
    handle = db ?? (await getDb());
    const cached = cache.get(handle);
    if (cached && Date.now() - cached.at < SETTINGS_CACHE_TTL_MS) return cached.info;
    const info = await load(handle);
    cache.set(handle, { at: Date.now(), info });
    return info;
  } catch (error) {
    // Not cached: the next read tries the database again.
    logOnce("database", "could not read the settings table; using defaults.", error);
    return { settings: { ...DEFAULT_SETTINGS }, lastChange: null };
  }
}

export async function getSettings(db?: Db): Promise<Settings> {
  return (await getSettingsInfo(db)).settings;
}

export interface UpdateSettingsOptions {
  /** Who is saving. Free text for now, stored in `updated_by`. */
  updatedBy: string;
  db?: Db;
}

/**
 * Upsert the known keys present in `patch`; unknown keys and wrong types throw
 * (a `ZodError`). Returns the settings as they are after the write.
 */
export async function updateSettings(patch: SettingsPatch, options: UpdateSettingsOptions): Promise<SettingsInfo> {
  const clean = settingsPatchSchema.parse(patch);
  const updatedBy = options.updatedBy.trim().slice(0, MAX_UPDATED_BY_LENGTH) || null;
  const db = options.db ?? (await getDb());

  const rows = KEYS.flatMap((key) => (clean[key] === undefined ? [] : [{ key, value: clean[key], updatedBy }]));
  if (rows.length > 0) {
    await db
      .insert(settingsTable)
      .values(rows)
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: sql`excluded.value`, updatedAt: sql`now()`, updatedBy: sql`excluded.updated_by` },
      });
  }
  invalidateSettingsCache();
  // Read back through `load`, not the forgiving getter: a save that cannot be confirmed is an error.
  const info = await load(db);
  cache.set(db, { at: Date.now(), info });
  return info;
}
