import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalog } from "@/catalog";
import { ExtractorError, extract, type ExtractorClient } from "./index";
import { normalizeQuantity } from "./normalize";
import { fakeClient, fakeMessage } from "./testing";

// extract() never decodes the screenshot itself, so any bytes will do.
const input = { image: new Uint8Array([137, 80, 78, 71]), mediaType: "image/png" as const };

interface RowOverrides {
  itemId?: string;
  quantity?: string | null;
  gameTimestamp?: string;
  character?: string;
  direction?: string;
  confidence?: number;
  lowConfidenceReason?: string | null;
}

function modelRow(overrides: RowOverrides = {}) {
  return {
    itemId: "gold-ingot",
    iconDescription: "A stack of yellow metal bars with a grey border.",
    quantity: "112",
    gameTimestamp: "06.09.2026 - 23:21",
    character: "Leftaltar",
    direction: "deposit",
    confidence: 0.95,
    lowConfidenceReason: "",
    ...overrides,
  };
}

function modelOutput(rows: ReturnType<typeof modelRow>[], extra: Record<string, unknown> = {}) {
  return { looksLikeBankLog: true, rows, notes: [], ...extra };
}

function run(output: unknown) {
  return extract(input, { client: fakeClient(fakeMessage(output)) });
}

async function failure(promise: Promise<unknown>): Promise<ExtractorError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ExtractorError);
  return error as ExtractorError;
}

function throwingClient(error: unknown): ExtractorClient {
  return {
    beta: {
      messages: {
        create: () => Promise.reject(error),
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extract: the rules the module owns", () => {
  it("drops withdraw and unclear rows and says how many", async () => {
    const result = await run(
      modelOutput([
        modelRow(),
        modelRow({ itemId: "iron-ingot", quantity: "1000", direction: "withdraw" }),
        modelRow({ itemId: "ruby", direction: "unknown" }),
        modelRow({ itemId: "ruby", quantity: "5", character: "xReacher" }),
      ]),
    );

    expect(result.rows.map((row) => [row.itemId, row.quantity, row.direction])).toEqual([
      ["gold-ingot", "112", "deposit"],
      ["ruby", "5", "deposit"],
    ]);
    expect(result.warnings.join("\n")).toMatch(/Dropped 2 non-deposit rows/);
    // Names come from the kept rows only.
    expect(result.characters).toEqual(["Leftaltar", "xReacher"]);
  });

  it("reads the inline Silver Coin amount and keeps values past 2^31 exact", async () => {
    const result = await run(
      modelOutput([
        modelRow({ itemId: "silver-coin", quantity: "500,000,000" }),
        modelRow({ itemId: "silver-coin", quantity: "10,000,000,000" }),
      ]),
    );

    expect(result.rows.map((row) => row.quantity)).toEqual(["500000000", "10000000000"]);
    expect(BigInt(result.rows[1].quantity)).toBe(10_000_000_000n);
  });

  it("treats a missing overlay number as a stack of 1", async () => {
    const result = await run(
      modelOutput([
        modelRow({ itemId: "nyxium", quantity: "" }),
        modelRow({ itemId: "nyxium", quantity: null }),
        modelRow({ itemId: "nyxium", quantity: "  " }),
      ]),
    );

    // Identical rows stay separate deposits.
    expect(result.rows.map((row) => row.quantity)).toEqual(["1", "1", "1"]);
    expect(result.rows.every((row) => row.confidence === 0.95)).toBe(true);
  });

  it("flags a quantity it cannot read instead of inventing one", async () => {
    const result = await run(modelOutput([modelRow({ quantity: "1.2k" })]));

    expect(result.rows[0].quantity).toBe("1");
    expect(result.rows[0].confidence).toBeLessThanOrEqual(0.3);
    expect(result.rows[0].lowConfidenceReason).toMatch(/1\.2k/);
  });

  it('allows "unknown" and demotes an id that is not in the catalog', async () => {
    const result = await run(
      modelOutput([
        modelRow({ itemId: "unknown", confidence: 0.6, lowConfidenceReason: "Icon is blurred." }),
        modelRow({ itemId: "dragon-scale", confidence: 0.99 }),
      ]),
    );

    expect(result.rows[0]).toMatchObject({
      itemId: "unknown",
      confidence: 0.6,
      lowConfidenceReason: "Icon is blurred.",
    });
    expect(result.rows[1].itemId).toBe("unknown");
    expect(result.rows[1].confidence).toBeLessThanOrEqual(0.3);
    expect(result.rows[1].lowConfidenceReason).toMatch(/dragon-scale/);
  });

  it("keeps confidence inside 0..1 and omits the reason on confident rows", async () => {
    const result = await run(
      modelOutput([modelRow({ confidence: 1.7 }), modelRow({ confidence: -2 })]),
    );

    expect(result.rows.map((row) => row.confidence)).toEqual([1, 0]);
    expect(result.rows[0]).not.toHaveProperty("lowConfidenceReason");
  });

  it("returns no rows for an image that is not a bank log", async () => {
    const result = await run({
      looksLikeBankLog: false,
      rows: [modelRow()],
      notes: ["Looks like an inventory window."],
    });

    expect(result.looksLikeBankLog).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.characters).toEqual([]);
    expect(result.warnings[0]).toMatch(/does not look like a guild bank log/);
    expect(result.warnings).toContain("Looks like an inventory window.");
  });

  it("reports the serving model and token usage", async () => {
    const message = fakeMessage(modelOutput([modelRow()]));
    message.usage.input_tokens = 321;
    message.usage.output_tokens = 45;
    message.usage.cache_read_input_tokens = 2000;

    const result = await extract(input, { client: fakeClient(message) });

    expect(result.model).toBe("claude-opus-5");
    expect(result.usage).toEqual({
      inputTokens: 321,
      outputTokens: 45,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 2000,
    });
  });
});

describe("normalizeQuantity", () => {
  it.each([
    ["112", "112"],
    ["1,000", "1000"],
    ["1.000.000", "1000000"],
    ["10 000 000 000", "10000000000"],
    ["007", "7"],
    [null, "1"],
  ])("%j -> %j", (raw, value) => {
    expect(normalizeQuantity(raw)).toEqual({ ok: true, value });
  });

  it.each(["12k", "-5", "0", "x"])("rejects %j", (raw) => {
    expect(normalizeQuantity(raw)).toEqual({ ok: false, raw });
  });
});

describe("extract: failures surface as ExtractorError", () => {
  it("refusal stop reason", async () => {
    const client = fakeClient(
      fakeMessage("", {
        content: [],
        stop_reason: "refusal",
        stop_details: {
          type: "refusal",
          category: null,
          explanation: "declined",
        } as Anthropic.Beta.BetaRefusalStopDetails,
      }),
    );
    const error = await failure(extract(input, { client }));
    expect(error.kind).toBe("refusal");
    expect(error.retryable).toBe(false);
  });

  it("max_tokens stop reason, even though the text is half a JSON document", async () => {
    const client = fakeClient(
      fakeMessage('{"looksLikeBankLog": true, "rows": [{"itemId": "gold', {
        stop_reason: "max_tokens",
      }),
    );
    const error = await failure(extract(input, { client }));
    expect(error.kind).toBe("invalid_output");
    expect(error.message).toMatch(/max_tokens/);
  });

  it("output that is not JSON, or not the expected shape", async () => {
    expect((await failure(run("sorry, I cannot"))).kind).toBe("invalid_output");
    expect((await failure(run({ looksLikeBankLog: true }))).kind).toBe("invalid_output");
  });

  it("SDK rate-limit error", async () => {
    const sdkError = new Anthropic.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "slow down" } },
      "slow down",
      new Headers({ "retry-after": "12" }),
    );
    const error = await failure(extract(input, { client: throwingClient(sdkError) }));

    expect(error.kind).toBe("rate_limit");
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(12);
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(sdkError);
  });

  it("SDK connection and timeout errors", async () => {
    const connection = new Anthropic.APIConnectionError({ message: "socket hang up" });
    const timeout = new Anthropic.APIConnectionTimeoutError();

    expect((await failure(extract(input, { client: throwingClient(connection) }))).kind).toBe(
      "network",
    );
    expect((await failure(extract(input, { client: throwingClient(timeout) }))).kind).toBe(
      "network",
    );
  });

  it("other SDK status errors, and bad credentials", async () => {
    const overloaded = new Anthropic.InternalServerError(
      529,
      { type: "error", error: { type: "overloaded_error", message: "overloaded" } },
      "overloaded",
      new Headers(),
    );
    const unauthorized = new Anthropic.AuthenticationError(
      401,
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      "invalid x-api-key",
      new Headers(),
    );

    const api = await failure(extract(input, { client: throwingClient(overloaded) }));
    expect(api.kind).toBe("api");
    expect(api.status).toBe(529);
    expect(api.retryable).toBe(true);
    expect((await failure(extract(input, { client: throwingClient(unauthorized) }))).kind).toBe(
      "config",
    );
  });

  it("anything else thrown by the client", async () => {
    const error = await failure(extract(input, { client: throwingClient(new Error("boom")) }));
    expect(error.kind).toBe("api");
  });

  it("missing API key when no client is injected", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    const error = await failure(extract(input));
    expect(error.kind).toBe("config");
    expect(error.message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("an effort level the API does not have", async () => {
    vi.stubEnv("EXTRACTOR_EFFORT", "turbo");
    const client = fakeClient(fakeMessage(modelOutput([])));

    expect((await failure(extract(input, { client }))).kind).toBe("config");
    expect(client.requests).toHaveLength(0);
  });

  it("upscale settings that make no sense", async () => {
    const client = fakeClient(fakeMessage(modelOutput([])));

    vi.stubEnv("EXTRACTOR_UPSCALE", "maybe");
    expect((await failure(extract(input, { client }))).message).toMatch(/EXTRACTOR_UPSCALE/);
    vi.stubEnv("EXTRACTOR_UPSCALE", "");
    vi.stubEnv("EXTRACTOR_UPSCALE_MAX_EDGE", "huge");
    expect((await failure(extract(input, { client }))).message).toMatch(/EXTRACTOR_UPSCALE_MAX_EDGE/);
    expect(client.requests).toHaveLength(0);
  });
});

describe("extract: request shape", () => {
  async function requestFor(deps: Parameters<typeof extract>[1] = {}, known?: string[]) {
    const client = fakeClient(fakeMessage(modelOutput([])));
    await extract({ ...input, knownCharacters: known }, { client, ...deps });
    expect(client.requests).toHaveLength(1);
    const [request] = client.requests;
    const content = request.messages[0].content;
    if (typeof content === "string") throw new Error("expected content blocks");
    return { request, content };
  }

  it("defaults to claude-opus-5 and leaves effort to the API", async () => {
    vi.stubEnv("EXTRACTOR_MODEL", "");
    vi.stubEnv("EXTRACTOR_EFFORT", "");
    const { request } = await requestFor();

    expect(request.model).toBe("claude-opus-5");
    expect(request.output_config).not.toHaveProperty("effort");
    expect(request.output_config?.format?.type).toBe("json_schema");
  });

  it("takes model and effort from deps, then from the environment", async () => {
    vi.stubEnv("EXTRACTOR_MODEL", "claude-sonnet-5");
    vi.stubEnv("EXTRACTOR_EFFORT", "low");

    const fromEnv = await requestFor();
    expect(fromEnv.request.model).toBe("claude-sonnet-5");
    expect(fromEnv.request.output_config?.effort).toBe("low");

    const fromDeps = await requestFor({ model: "claude-opus-5", effort: "high" });
    expect(fromDeps.request.model).toBe("claude-opus-5");
    expect(fromDeps.request.output_config?.effort).toBe("high");
  });

  it("puts every labelled reference icon before the screenshot, cache breakpoint on the last", async () => {
    const { content } = await requestFor({}, ["Leftaltar"]);
    const images = content.flatMap((block, index) => (block.type === "image" ? [index] : []));

    // One image per tracked item, then the screenshot.
    expect(images).toHaveLength(catalog.length + 1);
    const screenshotIndex = images[images.length - 1];
    const lastIconIndex = images[images.length - 2];

    catalog.forEach((item, position) => {
      const label = content[images[position] - 1];
      expect(label.type === "text" && label.text).toContain(`id: ${item.id},`);
    });

    const breakpoints = content.flatMap((block, index) =>
      "cache_control" in block && block.cache_control ? [index] : [],
    );
    expect(breakpoints).toEqual([lastIconIndex]);

    const screenshot = content[screenshotIndex];
    expect(screenshot.type === "image" && screenshot.source).toEqual({
      type: "base64",
      media_type: "image/png",
      data: Buffer.from(input.image).toString("base64"),
    });

    // The known names travel after the cached prefix.
    const ask = content[content.length - 1];
    expect(ask.type === "text" && ask.text).toContain("Leftaltar");
  });

  it("limits itemId to the catalog ids plus unknown in the output schema", async () => {
    const { request } = await requestFor();
    const schema = JSON.stringify(request.output_config?.format?.schema);
    const ids = [...catalog.map((item) => item.id), "unknown"];

    expect(schema).toContain(JSON.stringify(ids));
  });

  it("opts into server-side refusal fallbacks for claude-opus-5 only, unless told otherwise", async () => {
    vi.stubEnv("EXTRACTOR_MODEL", "");
    vi.stubEnv("EXTRACTOR_FALLBACKS", "");

    const byDefault = await requestFor();
    expect(byDefault.request.fallbacks).toBe("default");
    expect(byDefault.request.betas).toEqual(["server-side-fallback-2026-07-01"]);

    const otherModel = await requestFor({ model: "claude-sonnet-5" });
    expect(otherModel.request).not.toHaveProperty("fallbacks");
    expect(otherModel.request).not.toHaveProperty("betas");

    vi.stubEnv("EXTRACTOR_FALLBACKS", "off");
    const switchedOff = await requestFor();
    expect(switchedOff.request).not.toHaveProperty("fallbacks");
  });

  it("sends an enlarged PNG of a small screenshot, or the upload itself when switched off", async () => {
    const upload = await sharp({
      create: { width: 320, height: 200, channels: 3, background: { r: 22, g: 25, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    const sentImage = async (deps: Parameters<typeof extract>[1]) => {
      const client = fakeClient(fakeMessage(modelOutput([])));
      const result = await extract({ image: upload, mediaType: "image/jpeg" }, { client, ...deps });
      const content = client.requests[0].messages[0].content;
      if (typeof content === "string") throw new Error("expected content blocks");
      const image = content.findLast((block) => block.type === "image");
      if (image?.type !== "image" || image.source.type !== "base64") throw new Error("no screenshot");
      return { source: image.source, result };
    };

    const on = await sentImage({});
    expect(on.source.media_type).toBe("image/png");
    const sent = await sharp(Buffer.from(on.source.data, "base64")).metadata();
    expect([sent.width, sent.height]).toEqual([640, 400]);
    expect(on.result.upscale).toEqual({ applied: true, scale: 2, width: 320, height: 200 });

    const off = await sentImage({ upscale: false });
    expect(off.source).toEqual({
      type: "base64",
      media_type: "image/jpeg",
      data: upload.toString("base64"),
    });
    expect(off.result.upscale?.applied).toBe(false);

    vi.stubEnv("EXTRACTOR_UPSCALE", "off");
    expect((await sentImage({})).source.media_type).toBe("image/jpeg");
  });

  it("asks for box and quantityText, with the description before the id and the text before the digits", async () => {
    const { request } = await requestFor();
    const schema = request.output_config?.format?.schema as {
      properties: { rows: { items: { properties: Record<string, unknown>; required: string[] } } };
    };
    const fields = Object.keys(schema.properties.rows.items.properties);

    expect(schema.properties.rows.items.required).toEqual(expect.arrayContaining(["box", "quantityText"]));
    expect(fields.indexOf("iconDescription")).toBeLessThan(fields.indexOf("itemId"));
    expect(fields.indexOf("quantityText")).toBeLessThan(fields.indexOf("quantity"));
  });

  it("labels each fragment with what sets its jewelry apart", async () => {
    const { content } = await requestFor();
    const labels = content.flatMap((block) => (block.type === "text" ? [block.text] : []));

    for (const item of catalog.filter((entry) => entry.kind === "fragment")) {
      const label = labels.find((text) => text.includes(`id: ${item.id},`));
      expect(label).toMatch(/ignore the paper badge/);
    }
    expect(labels.find((text) => text.includes("id: gold-ingot,"))).not.toMatch(/badge/);
  });

  it("warns when a fallback model served the answer", async () => {
    const message = fakeMessage(modelOutput([modelRow()]), { model: "claude-opus-4-8" });
    message.usage.iterations = [
      { type: "fallback_message" } as NonNullable<Anthropic.Beta.BetaUsage["iterations"]>[number],
    ];

    const result = await extract(input, { client: fakeClient(message) });

    expect(result.model).toBe("claude-opus-4-8");
    expect(result.warnings.join("\n")).toMatch(/fallback model claude-opus-4-8/);
  });
});
