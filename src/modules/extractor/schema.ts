/**
 * What the model is asked to return (structured outputs), before our own
 * rules are applied in `normalize.ts`.
 *
 * Two variants of one shape:
 *  - the *request* schema pins `itemId`, `direction` and `borderColor` to
 *    closed enums, so constrained decoding can only pick a catalog id or
 *    "unknown";
 *  - the *parse* schema accepts any string there (and null for the "nothing to
 *    report" fields), so an off-list value from a fallback model or a
 *    hand-written mock degrades to a low-confidence row in `normalize.ts`
 *    instead of failing the whole extraction. `quantityText`, `box`,
 *    `borderColorWord` and `borderColor` are optional there: answers recorded
 *    before those fields existed still parse.
 *
 * The request schema deliberately sticks to the plainest JSON Schema
 * features (object, array, string, number, boolean, enum): no nullable
 * unions, no numeric or string constraints. "Nothing shown" is an empty
 * string. `normalize.ts` clamps and validates everything anyway.
 *
 * Field order is the order the model writes a row in, so it is the order of
 * looking: where the row is, what the icon looks like, what colour its border
 * is, and only then which item it is; the amount as printed and only then as
 * a number.
 */
import { z } from "zod";
import { RARITIES, RARITY_BORDER, type Rarity } from "@/catalog";

export const UNKNOWN_ITEM = "unknown";
export const DIRECTIONS = ["deposit", "withdraw", "unknown"] as const;

/** What the model reports about an icon's border: the rarity its colour stands for, or none / unclear. */
export const BORDER_COLORS = [...RARITIES, "none", "unclear"] as const;
export type BorderColor = (typeof BORDER_COLORS)[number];

export function isRarity(value: BorderColor): value is Rarity {
  return (RARITIES as readonly string[]).includes(value);
}

/**
 * "green = common, blue = uncommon, purple = rare or legendary, ..." from the
 * catalog's border table, so the prompt, the schema and `normalize.ts` agree
 * on which colour means which rarity. Deterministic: part of the cached prefix.
 */
export function borderLegend(): string {
  const byWord = new Map<string, Rarity[]>();
  for (const rarity of RARITIES) {
    const word = RARITY_BORDER[rarity].word;
    byWord.set(word, [...(byWord.get(word) ?? []), rarity]);
  }
  return [...byWord]
    .map(([word, rarities]) => `${word} = ${rarities.join(" or ")}`)
    .join(", ");
}

const DESCRIPTIONS = {
  box: "The row's vertical extent as fractions of the full image height: its top edge and bottom edge, where 0 is the top of the image and 1 the bottom, so top < bottom.",
  direction:
    '"deposit" only for a green up arrow with the word Deposit; "withdraw" for withdrawals; "unknown" if it cannot be told.',
  iconDescription:
    "One short sentence on what the icon looks like: shape, colours, border colour. For a blueprint fragment, the piece of jewelry in its top-left.",
  borderColorWord:
    'The colour of the thin border around the icon as you see it, in one plain word ("green", "blue", "purple", "red"). Empty string when the icon has no border.',
  borderColor: `The rarity that border colour stands for (${borderLegend()}); "none" when the icon has no border; "unclear" when the colour cannot be made out. What you see, not what the chosen item should have.`,
  itemId:
    'Id of the matching tracked reference icon (art and border both), or "unknown" if it is not a tracked item, matches a NOT tracked reference, or cannot be told.',
  quantityText:
    'The amount exactly as displayed, character for character, separators included (e.g. "500,000,000", "1000"). Empty string when no number is shown.',
  quantity:
    "The same amount as plain digits without separators. Empty string when no number is shown (a stack of 1).",
  gameTimestamp: 'Exactly as displayed, e.g. "06.09.2026 - 23:21".',
  character: "Character name exactly as displayed.",
  confidence: "0 to 1: probability that every field of this row is right.",
  lowConfidenceReason: "What is doubtful about this row. Empty string when confident.",
  looksLikeBankLog: "false when the image is not a guild bank log of the described kind.",
  rows: "Every visible log row, top to bottom. Empty when not a bank log.",
  notes: "Anything the person verifying should know (cut-off rows, blur). Usually empty.",
} as const;

/** Schema sent to the API: closed enums for item id, direction and border colour. */
export function buildRequestSchema(itemIds: readonly string[]) {
  const ids = [...new Set([...itemIds, UNKNOWN_ITEM])] as [string, ...string[]];
  return z.object({
    looksLikeBankLog: z.boolean().describe(DESCRIPTIONS.looksLikeBankLog),
    rows: z
      .array(
        z.object({
          box: z.object({ top: z.number(), bottom: z.number() }).describe(DESCRIPTIONS.box),
          direction: z.enum(DIRECTIONS).describe(DESCRIPTIONS.direction),
          iconDescription: z.string().describe(DESCRIPTIONS.iconDescription),
          borderColorWord: z.string().describe(DESCRIPTIONS.borderColorWord),
          borderColor: z.enum(BORDER_COLORS).describe(DESCRIPTIONS.borderColor),
          itemId: z.enum(ids).describe(DESCRIPTIONS.itemId),
          quantityText: z.string().describe(DESCRIPTIONS.quantityText),
          quantity: z.string().describe(DESCRIPTIONS.quantity),
          gameTimestamp: z.string().describe(DESCRIPTIONS.gameTimestamp),
          character: z.string().describe(DESCRIPTIONS.character),
          confidence: z.number().describe(DESCRIPTIONS.confidence),
          lowConfidenceReason: z.string().describe(DESCRIPTIONS.lowConfidenceReason),
        }),
      )
      .describe(DESCRIPTIONS.rows),
    notes: z.array(z.string()).describe(DESCRIPTIONS.notes),
  });
}

/**
 * The `output_config.format` value for a request.
 *
 * Built from Zod's own JSON Schema rather than the SDK's `zodOutputFormat`
 * helper: that helper (SDK 0.127.0) rewrites `enum` into a description hint,
 * which would leave the item id unconstrained. `enum` is supported by
 * structured outputs, and the closed set is the point of this schema.
 */
export function buildOutputFormat(itemIds: readonly string[]): {
  type: "json_schema";
  schema: Record<string, unknown>;
} {
  const schema: Record<string, unknown> = { ...z.toJSONSchema(buildRequestSchema(itemIds)) };
  delete schema.$schema; // dialect marker, not part of the schema proper
  return { type: "json_schema", schema };
}

/** Schema used to read the response: same shape, tolerant of off-list values. */
export const modelOutputSchema = z.object({
  looksLikeBankLog: z.boolean(),
  rows: z.array(
    z.object({
      itemId: z.string(),
      iconDescription: z.string(),
      /** Absent in answers recorded before the fields existed; off-list values are handled in `normalize.ts`. */
      borderColorWord: z.string().nullable().optional(),
      borderColor: z.string().nullable().optional(),
      quantity: z.string().nullable(),
      /** Absent in answers recorded before the field existed. */
      quantityText: z.string().nullable().optional(),
      /** Checked in `normalize.ts`: a malformed box is dropped, it does not fail the answer. */
      box: z.unknown().optional(),
      gameTimestamp: z.string(),
      character: z.string(),
      direction: z.string(),
      confidence: z.number(),
      lowConfidenceReason: z.string().nullable(),
    }),
  ),
  notes: z.array(z.string()),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;
export type ModelRow = ModelOutput["rows"][number];
