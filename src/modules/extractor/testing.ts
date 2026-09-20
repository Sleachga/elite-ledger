/**
 * Fakes for running the extractor without the network: used by the unit tests
 * and by `pnpm eval:extractor --mock`. Not part of the module's public API.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ExtractorClient } from "./index";

type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.BetaMessage;

/** A complete API message whose single text block is `output` as JSON. */
export function fakeMessage(output: unknown, overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    container: null,
    context_management: null,
    diagnostics: null,
    content: [
      {
        type: "text",
        text: typeof output === "string" ? output : JSON.stringify(output),
        citations: null,
      },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      fallback_credit: null,
      inference_geo: null,
      iterations: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
    },
    ...overrides,
  };
}

export interface FakeClient extends ExtractorClient {
  /** Every request the extractor made, in order. */
  requests: CreateParams[];
}

/**
 * A client whose `create` resolves to `reply` (or to what `reply(params)`
 * returns / throws). Records the requests it receives.
 */
export function fakeClient(reply: Message | ((params: CreateParams) => Message)): FakeClient {
  const requests: CreateParams[] = [];
  return {
    requests,
    beta: {
      messages: {
        async create(params) {
          requests.push(params);
          return typeof reply === "function" ? reply(params) : reply;
        },
      },
    },
  };
}
