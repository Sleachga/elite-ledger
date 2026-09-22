import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The extractor is mocked: no Anthropic client is ever built and no request is made.
vi.mock("@/modules/extractor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/extractor")>()),
  extract: vi.fn(),
}));

// The app's database is an in-memory PGlite: the route reads the real settings table.
const memory = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: async () => memory.db,
}));

import { createDb, type DbHandle } from "@/db";
import { settings as settingsTable } from "@/db/schema";
import { ExtractorError, extract, type ExtractionResult } from "@/modules/extractor";
import { MAX_IMAGE_BYTES } from "@/modules/playground";
import { MAX_BATCH_IMAGES, interpretResponse } from "@/modules/playground/queue";
import { invalidateSettingsCache, updateSettings } from "@/modules/settings";
import { RATE_LIMIT, resetRateLimit } from "./handler";
import { GET, POST } from "./route";

const extractMock = vi.mocked(extract);

let handle: DbHandle;

beforeAll(async () => {
  handle = await createDb({ memory: true });
  await handle.migrate();
  memory.db = handle.db;
}, 60_000);

afterAll(async () => {
  await handle?.close();
});

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const RESULT: ExtractionResult = {
  looksLikeBankLog: true,
  rows: [
    {
      itemId: "silver-coin",
      iconDescription: "A bag of coins.",
      quantity: "10000000000",
      gameTimestamp: "06.09.2026 - 23:21",
      character: "Leftaltar",
      direction: "deposit",
      confidence: 0.97,
    },
  ],
  characters: ["Leftaltar"],
  warnings: [],
  model: "claude-opus-5",
  usage: { inputTokens: 1200, outputTokens: 300, cacheCreationInputTokens: 0, cacheReadInputTokens: 900 },
};

interface PostOptions {
  bytes?: Uint8Array;
  type?: string;
  field?: string;
  passcode?: string;
  ip?: string;
  headers?: Record<string, string>;
}

function post(options: PostOptions = {}): Promise<Response> {
  const { bytes = PNG_BYTES, type = "image/png", field = "image", passcode, ip, headers = {} } = options;
  const form = new FormData();
  form.append(field, new File([bytes as BlobPart], "screenshot", { type }));
  const allHeaders: Record<string, string> = { ...headers };
  if (passcode !== undefined) allHeaders["x-try-passcode"] = passcode;
  if (ip !== undefined) allHeaders["x-forwarded-for"] = ip;
  return POST(
    new Request("http://localhost/api/try-extract", { method: "POST", body: form, headers: allHeaders }),
  );
}

async function errorOf(response: Response): Promise<{ kind: string; message: string }> {
  const body = (await response.json()) as { error: { kind: string; message: string } };
  return body.error;
}

beforeEach(async () => {
  vi.stubEnv("TRY_PASSCODE", "");
  vi.stubEnv("VERCEL", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  extractMock.mockReset();
  extractMock.mockResolvedValue(RESULT);
  resetRateLimit();
  // Every test starts from the defaults: AI on, default mode AI.
  await handle.db.delete(settingsTable);
  invalidateSettingsCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Flip admin settings the way the admin route does. */
function adminSets(patch: Parameters<typeof updateSettings>[0]) {
  return updateSettings(patch, { updatedBy: "test" });
}

describe("GET /api/try-extract", () => {
  it("is open locally when no passcode is set", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      passcodeRequired: false,
      enabled: true,
      aiEnabled: true,
      defaultMode: "ai",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("asks for a passcode when TRY_PASSCODE is set", async () => {
    vi.stubEnv("TRY_PASSCODE", "open-sesame");
    vi.stubEnv("VERCEL", "1");
    expect(await (await GET()).json()).toMatchObject({ passcodeRequired: true, enabled: true });
  });

  it("reports disabled on Vercel without a passcode", async () => {
    vi.stubEnv("VERCEL", "1");
    expect(await (await GET()).json()).toMatchObject({ passcodeRequired: false, enabled: false });
  });

  it("reports the admin's upload-mode settings", async () => {
    await adminSets({ aiExtractionEnabled: false, defaultUploadMode: "manual" });
    expect(await (await GET()).json()).toEqual({
      passcodeRequired: false,
      enabled: true,
      aiEnabled: false,
      defaultMode: "manual",
    });

    // Switched back on: the very next answer says so (the save drops the cache).
    await adminSets({ aiExtractionEnabled: true });
    expect(await (await GET()).json()).toMatchObject({ aiEnabled: true, defaultMode: "manual" });
  });
});

describe("POST /api/try-extract with AI reading switched off", () => {
  beforeEach(async () => {
    await adminSets({ aiExtractionEnabled: false });
  });

  it("refuses with 403 ai_disabled and never calls the extractor", async () => {
    const response = await post();
    expect(response.status).toBe(403);
    const error = await errorOf(response);
    expect(error.kind).toBe("ai_disabled");
    expect(error.message).toContain("switched off");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(extractMock).not.toHaveBeenCalled();
    // The page reads that answer as "go manual", not as a failed image.
    expect(interpretResponse(403, { error }, null, Date.now())).toEqual({ type: "ai_disabled" });
  });

  it("refuses whatever the passcode", async () => {
    vi.stubEnv("TRY_PASSCODE", "open-sesame");
    expect((await post({ passcode: "open-sesame" })).status).toBe(403);
    expect((await post({ passcode: "wrong" })).status).toBe(403);
    expect((await post()).status).toBe(403);
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("refuses before the rate limiter: refused calls take no slot", async () => {
    for (let index = 0; index < RATE_LIMIT.limit + 5; index += 1) {
      expect((await post({ ip: "203.0.113.20" })).status).toBe(403);
    }
    // Back on: the same client still has its whole window.
    await adminSets({ aiExtractionEnabled: true });
    for (let index = 0; index < RATE_LIMIT.limit; index += 1) {
      expect((await post({ ip: "203.0.113.20" })).status).toBe(200);
    }
    expect((await post({ ip: "203.0.113.20" })).status).toBe(429);
    expect(extractMock).toHaveBeenCalledTimes(RATE_LIMIT.limit);
  });

  it("refuses before looking at the body", async () => {
    const response = await POST(
      new Request("http://localhost/api/try-extract", {
        method: "POST",
        body: JSON.stringify({ image: "nope" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("still answers 503 first when the playground itself is off on this deployment", async () => {
    vi.stubEnv("VERCEL", "1");
    const response = await post();
    expect(response.status).toBe(503);
    expect((await errorOf(response)).kind).toBe("disabled");
  });

  it("the default mode alone does not gate anything", async () => {
    await adminSets({ aiExtractionEnabled: true, defaultUploadMode: "manual" });
    expect((await post()).status).toBe(200);
    expect(extractMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/try-extract", () => {
  it("runs the extractor and returns the result with a duration", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: ExtractionResult; durationMs: number };
    expect(body.result).toEqual(RESULT);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(extractMock).toHaveBeenCalledTimes(1);
    const [input] = extractMock.mock.calls[0];
    expect(input.mediaType).toBe("image/png");
    expect([...input.image]).toEqual([...PNG_BYTES]);
  });

  it("passes the media type found in the bytes, not the declared one", async () => {
    const response = await post({ bytes: JPEG_BYTES, type: "image/png" });
    expect(response.status).toBe(200);
    expect(extractMock.mock.calls[0][0].mediaType).toBe("image/jpeg");
  });

  it("rejects a wrong MIME type with 400", async () => {
    const response = await post({ type: "image/gif" });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).kind).toBe("bad_request");
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("rejects bytes that are not an image with 400", async () => {
    const response = await post({ bytes: new TextEncoder().encode("not an image"), type: "image/png" });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).kind).toBe("bad_request");
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("rejects a missing image field and a non-multipart body with 400", async () => {
    expect((await post({ field: "file" })).status).toBe(400);

    const response = await POST(
      new Request("http://localhost/api/try-extract", {
        method: "POST",
        body: JSON.stringify({ image: "nope" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(400);
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("rejects an image over 10 MB with 413", async () => {
    const bytes = new Uint8Array(MAX_IMAGE_BYTES + 1);
    bytes.set(PNG_BYTES);
    const response = await post({ bytes });
    expect(response.status).toBe(413);
    expect((await errorOf(response)).kind).toBe("too_large");
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("accepts an image of exactly 10 MB", async () => {
    const bytes = new Uint8Array(MAX_IMAGE_BYTES);
    bytes.set(PNG_BYTES);
    expect((await post({ bytes })).status).toBe(200);
  });

  describe("passcode gate", () => {
    beforeEach(() => {
      vi.stubEnv("TRY_PASSCODE", "open-sesame");
    });

    it("401 when the header is missing", async () => {
      const response = await post();
      expect(response.status).toBe(401);
      expect((await errorOf(response)).kind).toBe("unauthorized");
      expect(extractMock).not.toHaveBeenCalled();
    });

    it("401 when the passcode is wrong", async () => {
      for (const passcode of ["open-sesam", "open-sesame!", "OPEN-SESAME", "x"]) {
        const response = await post({ passcode });
        expect(response.status).toBe(401);
      }
      expect(extractMock).not.toHaveBeenCalled();
    });

    it("200 when the passcode matches, on Vercel too", async () => {
      vi.stubEnv("VERCEL", "1");
      const response = await post({ passcode: "open-sesame" });
      expect(response.status).toBe(200);
      expect(extractMock).toHaveBeenCalledTimes(1);
    });
  });

  it("503 on Vercel when no passcode is configured, even if one is sent", async () => {
    vi.stubEnv("VERCEL", "1");
    const response = await post({ passcode: "anything" });
    expect(response.status).toBe(503);
    expect((await errorOf(response)).kind).toBe("disabled");
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("allows 60 requests per 10 minutes per IP", () => {
    expect(RATE_LIMIT).toEqual({ limit: 60, windowMs: 10 * 60 * 1000 });
  });

  it("lets two full 20-image batches plus retries through", async () => {
    for (let index = 0; index < 2 * MAX_BATCH_IMAGES + 10; index += 1) {
      expect((await post({ ip: "203.0.113.6" })).status).toBe(200);
    }
  });

  it("limits requests per IP with 429 and Retry-After", async () => {
    for (let index = 0; index < RATE_LIMIT.limit; index += 1) {
      expect((await post({ ip: "203.0.113.7" })).status).toBe(200);
    }
    const limited = await post({ ip: "203.0.113.7, 10.0.0.1" });
    expect(limited.status).toBe(429);
    expect((await errorOf(limited)).kind).toBe("too_many_requests");

    // Retry-After: whole seconds until the window resets, never past the window itself.
    const retryAfter = limited.headers.get("retry-after");
    expect(retryAfter).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(RATE_LIMIT.windowMs / 1000);
    expect((await errorOf(await post({ ip: "203.0.113.7" }))).message).toContain("seconds");
    // The page reads the same header to word the wait.
    expect(interpretResponse(429, null, retryAfter, Date.now())).toMatchObject({
      type: "failure",
      error: { kind: "too_many_requests", retryAfterSeconds: Number(retryAfter) },
    });

    // Another client is unaffected.
    expect((await post({ ip: "203.0.113.8" })).status).toBe(200);
    expect(extractMock).toHaveBeenCalledTimes(RATE_LIMIT.limit + 1);
  });

  it("counts wrong passcodes against the limit", async () => {
    vi.stubEnv("TRY_PASSCODE", "open-sesame");
    for (let index = 0; index < RATE_LIMIT.limit; index += 1) {
      expect((await post({ ip: "203.0.113.9", passcode: "guess" })).status).toBe(401);
    }
    expect((await post({ ip: "203.0.113.9", passcode: "open-sesame" })).status).toBe(429);
  });

  describe("ExtractorError mapping", () => {
    const cases = [
      ["config", 500],
      ["rate_limit", 429],
      ["refusal", 422],
      ["invalid_output", 502],
      ["api", 502],
      ["network", 504],
    ] as const;

    it.each(cases)("%s -> %i", async (kind, status) => {
      extractMock.mockRejectedValueOnce(new ExtractorError(kind, `boom: ${kind}`));
      const response = await post();
      expect(response.status).toBe(status);
      expect(await errorOf(response)).toEqual({ kind, message: `boom: ${kind}` });
    });

    it("forwards retry-after from an API rate limit", async () => {
      extractMock.mockRejectedValueOnce(
        new ExtractorError("rate_limit", "slow down", { status: 429, retryAfterSeconds: 12.2 }),
      );
      const response = await post();
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("13");
    });

    it("turns an unexpected throw into a 500 without leaking it", async () => {
      extractMock.mockRejectedValueOnce(new Error("secret detail"));
      const response = await post();
      expect(response.status).toBe(500);
      expect((await errorOf(response)).message).not.toContain("secret detail");
    });
  });
});
