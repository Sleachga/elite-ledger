import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The app's database is an in-memory PGlite: the route works on the real settings table.
const memory = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: async () => memory.db,
}));

import { createDb, type DbHandle } from "@/db";
import { settings as settingsTable } from "@/db/schema";
import { getSettings, invalidateSettingsCache } from "@/modules/settings";
import type { AdminSettingsBody } from "@/modules/settings/api";
import { RATE_LIMIT, resetRateLimit } from "./handler";
import { GET, PUT } from "./route";

const ENDPOINT = "http://localhost/api/admin/settings";

let handle: DbHandle;

beforeAll(async () => {
  handle = await createDb({ memory: true });
  await handle.migrate();
  memory.db = handle.db;
}, 60_000);

afterAll(async () => {
  await handle?.close();
});

beforeEach(async () => {
  vi.stubEnv("ADMIN_PASSCODE", "");
  vi.stubEnv("TRY_PASSCODE", "");
  vi.stubEnv("VERCEL", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  resetRateLimit();
  await handle.db.delete(settingsTable);
  invalidateSettingsCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

interface CallOptions {
  passcode?: string;
  ip?: string;
}

function headersOf({ passcode, ip }: CallOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (passcode !== undefined) headers["x-admin-passcode"] = passcode;
  if (ip !== undefined) headers["x-forwarded-for"] = ip;
  return headers;
}

function get(options: CallOptions = {}): Promise<Response> {
  return GET(new Request(ENDPOINT, { headers: headersOf(options) }));
}

function put(body: unknown, options: CallOptions = {}): Promise<Response> {
  return PUT(
    new Request(ENDPOINT, {
      method: "PUT",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", ...headersOf(options) },
    }),
  );
}

async function errorOf(response: Response): Promise<{ kind: string; message: string }> {
  return ((await response.json()) as { error: { kind: string; message: string } }).error;
}

const VALID = { patch: { aiExtractionEnabled: false }, updatedBy: "Sandy" };

describe("gate", () => {
  it("is open locally when ADMIN_PASSCODE is not set", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await put(VALID)).status).toBe(200);
  });

  it("503 on Vercel when ADMIN_PASSCODE is not set, whatever is sent", async () => {
    vi.stubEnv("VERCEL", "1");
    for (const response of [await get(), await get({ passcode: "anything" }), await put(VALID, { passcode: "anything" })]) {
      expect(response.status).toBe(503);
      const error = await errorOf(response);
      expect(error.kind).toBe("disabled");
      expect(error.message.toLowerCase()).toContain("admin disabled");
    }
    expect(await handle.db.select().from(settingsTable)).toHaveLength(0);
  });

  describe("with ADMIN_PASSCODE set", () => {
    beforeEach(() => {
      vi.stubEnv("ADMIN_PASSCODE", "let-me-in");
    });

    it("401 without the header, on GET and PUT", async () => {
      for (const response of [await get(), await put(VALID)]) {
        expect(response.status).toBe(401);
        expect((await errorOf(response)).kind).toBe("unauthorized");
      }
      expect(await handle.db.select().from(settingsTable)).toHaveLength(0);
    });

    it("401 with a wrong passcode", async () => {
      for (const passcode of ["let-me-i", "let-me-in!", "LET-ME-IN", "x", " "]) {
        expect((await get({ passcode })).status).toBe(401);
        expect((await put(VALID, { passcode })).status).toBe(401);
      }
      expect(await handle.db.select().from(settingsTable)).toHaveLength(0);
    });

    it("does not accept the playground's passcode", async () => {
      vi.stubEnv("TRY_PASSCODE", "open-sesame");
      expect((await get({ passcode: "open-sesame" })).status).toBe(401);
    });

    it("200 with the right passcode, on Vercel too", async () => {
      vi.stubEnv("VERCEL", "1");
      expect((await get({ passcode: "let-me-in" })).status).toBe(200);
      expect((await put(VALID, { passcode: "let-me-in" })).status).toBe(200);
    });

    it("limits guessing: 30 requests per 10 minutes per IP, wrong passcodes included", async () => {
      expect(RATE_LIMIT).toEqual({ limit: 30, windowMs: 10 * 60 * 1000 });
      for (let index = 0; index < RATE_LIMIT.limit; index += 1) {
        expect((await get({ ip: "203.0.113.30", passcode: `guess-${index}` })).status).toBe(401);
      }
      const limited = await get({ ip: "203.0.113.30", passcode: "let-me-in" });
      expect(limited.status).toBe(429);
      expect((await errorOf(limited)).kind).toBe("too_many_requests");
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      // Another client is unaffected.
      expect((await get({ ip: "203.0.113.31", passcode: "let-me-in" })).status).toBe(200);
    });
  });
});

describe("GET", () => {
  it("returns the defaults and no last change on a fresh database", async () => {
    expect(await (await get()).json()).toEqual({
      settings: { aiExtractionEnabled: true, defaultUploadMode: "ai" },
      lastChange: null,
    });
  });
});

describe("PUT validation", () => {
  const bad: [string, unknown][] = [
    ["an unknown setting", { patch: { aiExtractionEnabled: false, maxUploads: 3 }, updatedBy: "Sandy" }],
    ["an unknown top-level key", { ...VALID, force: true }],
    ["a wrong type for the switch", { patch: { aiExtractionEnabled: "false" }, updatedBy: "Sandy" }],
    ["a wrong value for the mode", { patch: { defaultUploadMode: "auto" }, updatedBy: "Sandy" }],
    ["a null value", { patch: { defaultUploadMode: null }, updatedBy: "Sandy" }],
    ["an empty patch", { patch: {}, updatedBy: "Sandy" }],
    ["no patch", { updatedBy: "Sandy" }],
    ["no name", { patch: { aiExtractionEnabled: false } }],
    ["a blank name", { patch: { aiExtractionEnabled: false }, updatedBy: "   " }],
    ["a name that is not text", { patch: { aiExtractionEnabled: false }, updatedBy: 7 }],
    ["a name that is too long", { patch: { aiExtractionEnabled: false }, updatedBy: "x".repeat(81) }],
    ["an array", [VALID]],
    ["a bare value", true],
  ];

  it.each(bad)("400 for %s, and nothing is written", async (_label, body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).kind).toBe("bad_request");
    expect(await handle.db.select().from(settingsTable)).toHaveLength(0);
  });

  it("400 for a body that is not JSON", async () => {
    const response = await put("aiExtractionEnabled=false");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).kind).toBe("bad_request");
  });

  it("names the offending key", async () => {
    const error = await errorOf(await put({ patch: { maxUploads: 3 }, updatedBy: "Sandy" }));
    expect(error.message).toContain("maxUploads");
  });
});

describe("PUT", () => {
  it("saves, answers with the new settings and who changed them", async () => {
    const before = Date.now();
    const response = await put({ patch: { aiExtractionEnabled: false, defaultUploadMode: "manual" }, updatedBy: "  Sandy " });
    expect(response.status).toBe(200);
    const body = (await response.json()) as AdminSettingsBody;
    expect(body.settings).toEqual({ aiExtractionEnabled: false, defaultUploadMode: "manual" });
    expect(body.lastChange?.by).toBe("Sandy");
    expect(Date.parse(body.lastChange?.at ?? "")).toBeGreaterThanOrEqual(before - 5000);

    expect(await (await get()).json()).toEqual(body);
    const rows = await handle.db.select().from(settingsTable);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.updatedBy === "Sandy")).toBe(true);
  });

  it("drops the settings cache, so the upload screen sees the change at once", async () => {
    // Warm the cache the way the upload screen's status call does.
    expect((await getSettings()).aiExtractionEnabled).toBe(true);
    expect((await put(VALID)).status).toBe(200);
    expect((await getSettings()).aiExtractionEnabled).toBe(false);

    expect((await put({ patch: { aiExtractionEnabled: true }, updatedBy: "Sandy" })).status).toBe(200);
    expect((await getSettings()).aiExtractionEnabled).toBe(true);
  });

  it("a partial update leaves the other setting alone", async () => {
    await put({ patch: { defaultUploadMode: "manual" }, updatedBy: "A" });
    const body = (await (await put({ patch: { aiExtractionEnabled: false }, updatedBy: "B" })).json()) as AdminSettingsBody;
    expect(body.settings).toEqual({ aiExtractionEnabled: false, defaultUploadMode: "manual" });
    expect(body.lastChange?.by).toBe("B");
  });

  it("500 (not a crash) when the database refuses the write", async () => {
    const real = memory.db;
    memory.db = {
      insert: () => {
        throw new Error("relation \"settings\" does not exist");
      },
    };
    try {
      const response = await put(VALID);
      expect(response.status).toBe(500);
      const error = await errorOf(response);
      expect(error.kind).toBe("database");
      expect(error.message).not.toContain("relation");
    } finally {
      memory.db = real;
    }
  });
});
