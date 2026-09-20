/**
 * Extractor: bank-log screenshot in, verified-shape deposit rows out.
 *
 * This directory is the only place in the codebase allowed to import
 * `@anthropic-ai/sdk` (enforced by ESLint `no-restricted-imports`).
 *
 * The model returns every row it sees; `normalize.ts` applies the rules this
 * module owns (deposits only, silver inline amounts, bigint-safe quantities,
 * closed item set, "not a bank log"). Nothing but `ExtractorError` is thrown.
 */
import Anthropic from "@anthropic-ai/sdk";
import { catalog as vendoredCatalog, type CatalogItem } from "@/catalog";
import { ExtractorError, toExtractorError } from "./errors";
import { normalizeOutput, type ParsedRow } from "./normalize";
import { SYSTEM_PROMPT, buildUserContent, defaultIconsDir, type ImageMediaType } from "./prompt";
import { buildOutputFormat, modelOutputSchema, type ModelOutput } from "./schema";

export { ExtractorError, type ExtractorErrorKind } from "./errors";
export type { ParsedRow } from "./normalize";
export type { ImageMediaType } from "./prompt";

export const DEFAULT_MODEL = "claude-opus-5";
/** Non-streaming ceiling that stays inside SDK HTTP timeouts; leaves room for thinking. */
const MAX_TOKENS = 16000;
/** Beta header for the scalar `fallbacks: "default"` form (not the array form's header). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ExtractorEffort = (typeof EFFORT_LEVELS)[number];

type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.BetaMessage;

/**
 * The slice of the Anthropic client the extractor uses. A real `Anthropic`
 * instance satisfies it; tests and the mock eval inject a fake.
 */
export interface ExtractorClient {
  beta: {
    messages: {
      create(params: CreateParams, options?: Anthropic.RequestOptions): PromiseLike<Message>;
    };
  };
}

export interface ExtractInput {
  image: Uint8Array | Buffer;
  mediaType: ImageMediaType;
  /** The uploader's character names, if any are already known. */
  knownCharacters?: string[];
}

export interface ExtractDeps {
  /** Defaults to a lazily constructed `new Anthropic()` (needs ANTHROPIC_API_KEY). */
  client?: ExtractorClient;
  /** Tracked items. Defaults to the vendored catalog. */
  catalog?: readonly CatalogItem[];
  /** Where the catalog's icon files live. Defaults to `<cwd>/public/icons`. */
  iconsDir?: string;
  /** Defaults to env `EXTRACTOR_MODEL`, then `claude-opus-5`. */
  model?: string;
  /** Defaults to env `EXTRACTOR_EFFORT`; when unset the parameter is omitted (API default). */
  effort?: ExtractorEffort;
  /**
   * Server-side refusal fallbacks (`fallbacks: "default"`, beta). Defaults to
   * env `EXTRACTOR_FALLBACKS` ("on" / "off"), then to on for `claude-opus-5`
   * and off for any other model.
   */
  fallbacks?: boolean;
}

export interface ExtractionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ExtractionResult {
  looksLikeBankLog: boolean;
  /** Deposit rows only, top to bottom. */
  rows: ParsedRow[];
  /** Distinct character names on those rows. */
  characters: string[];
  warnings: string[];
  /** The model that produced the answer (differs from the request if a fallback served it). */
  model: string;
  usage: ExtractionUsage;
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function resolveEffort(explicit: ExtractorEffort | undefined): ExtractorEffort | undefined {
  const value = explicit ?? envValue("EXTRACTOR_EFFORT");
  if (value === undefined) return undefined;
  if (!(EFFORT_LEVELS as readonly string[]).includes(value)) {
    throw new ExtractorError(
      "config",
      `EXTRACTOR_EFFORT must be one of ${EFFORT_LEVELS.join(", ")} (got "${value}").`,
    );
  }
  return value as ExtractorEffort;
}

function resolveFallbacks(explicit: boolean | undefined, model: string): boolean {
  if (explicit !== undefined) return explicit;
  const value = envValue("EXTRACTOR_FALLBACKS")?.toLowerCase();
  if (value === undefined) return model === DEFAULT_MODEL;
  if (value === "on" || value === "off") return value === "on";
  throw new ExtractorError("config", `EXTRACTOR_FALLBACKS must be "on" or "off" (got "${value}").`);
}

let defaultClient: Anthropic | undefined;

function getDefaultClient(): ExtractorClient {
  if (!envValue("ANTHROPIC_API_KEY") && !envValue("ANTHROPIC_AUTH_TOKEN")) {
    throw new ExtractorError(
      "config",
      "ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example) or pass deps.client.",
    );
  }
  defaultClient ??= new Anthropic();
  return defaultClient;
}

function readModelOutput(message: Message): ModelOutput {
  // Check why the model stopped before touching the content: on a refusal or
  // a truncation the text is not guaranteed to match the schema.
  if (message.stop_reason === "refusal") {
    const details = message.stop_details;
    const about = [details?.category, details?.explanation].filter(Boolean).join(": ");
    throw new ExtractorError(
      "refusal",
      `The model declined to read this image${about ? ` (${about})` : ""}.`,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new ExtractorError(
      "invalid_output",
      `The model's answer was cut off at max_tokens (${MAX_TOKENS}); the screenshot may hold too many rows.`,
    );
  }
  if (message.stop_reason !== "end_turn") {
    throw new ExtractorError(
      "invalid_output",
      `Unexpected stop_reason "${String(message.stop_reason)}" from the model.`,
    );
  }

  const text = message.content.find(
    (block): block is Anthropic.Beta.BetaTextBlock => block.type === "text",
  )?.text;
  if (text === undefined) {
    throw new ExtractorError("invalid_output", "The model's answer contained no text block.");
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new ExtractorError("invalid_output", "The model's answer was not valid JSON.", { cause });
  }
  const parsed = modelOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new ExtractorError(
      "invalid_output",
      `The model's answer did not match the expected shape: ${parsed.error.message}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function servedByFallback(message: Message): boolean {
  // `usage.iterations` is the served-by signal; sticky-routed turns carry no
  // `fallback` content block.
  return (message.usage.iterations ?? []).some((entry) => entry.type === "fallback_message");
}

export async function extract(
  input: ExtractInput,
  deps: ExtractDeps = {},
): Promise<ExtractionResult> {
  try {
    if (input.image.byteLength === 0) {
      throw new ExtractorError("config", "The screenshot is empty (0 bytes).");
    }
    const catalog = deps.catalog ?? vendoredCatalog;
    const model = deps.model ?? envValue("EXTRACTOR_MODEL") ?? DEFAULT_MODEL;
    const effort = resolveEffort(deps.effort);
    const fallbacks = resolveFallbacks(deps.fallbacks, model);

    const content = await buildUserContent({
      catalog,
      iconsDir: deps.iconsDir ?? defaultIconsDir(),
      screenshot: { data: input.image, mediaType: input.mediaType },
      knownCharacters: input.knownCharacters ?? [],
    });
    const itemIds = catalog.map((item) => item.id);

    // `thinking` is left out on purpose: claude-opus-5 runs adaptive thinking
    // by default, and omitting it keeps the request valid for any model the
    // eval is pointed at. No sampling parameters (rejected by current models).
    const params: CreateParams = {
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      output_config: {
        format: buildOutputFormat(itemIds),
        ...(effort ? { effort } : {}),
      },
      ...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    };

    const client = deps.client ?? getDefaultClient();
    const message = await client.beta.messages.create(params);

    const normalized = normalizeOutput(readModelOutput(message), itemIds);
    if (servedByFallback(message)) {
      normalized.warnings.push(
        `${model} declined this request; the answer came from the fallback model ${message.model}.`,
      );
    }

    return {
      ...normalized,
      model: message.model,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
      },
    };
  } catch (error) {
    throw toExtractorError(error);
  }
}
