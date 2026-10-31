import { z } from "zod";
import type { Decision } from "../agent/types";
import { type Engine, EngineError } from "../engine";
import { prepareDeclaration, preparedSwap } from "./intent";
import { SYSTEM_PROMPT } from "./prompt";

const chatSchema = z.object({
  role: z.literal("user"),
  message: z.string().min(1).max(4000),
  address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .default([]),
});
const declarations = [
  { name: "get_market", description: "Read live market status; all settlement is paper." },
  { name: "get_decisions", description: "Read the deterministic decision journal." },
  {
    name: "explain_decision",
    description: "Read one decision by id.",
    parameters: { type: "OBJECT", properties: { id: { type: "STRING" } }, required: ["id"] },
  },
  { name: "get_arena", description: "Read paper P&L, never real revenue." },
  { name: "get_taker", description: "Read only the caller's public taker tier." },
  prepareDeclaration,
];
const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          role: z.string().optional(),
          parts: z.array(
            z.looseObject({
              text: z.string().optional(),
              functionCall: z
                .object({
                  name: z.string(),
                  args: z.record(z.string(), z.unknown()).default({}),
                  id: z.string().optional(),
                })
                .optional(),
            }),
          ),
        }),
      }),
    )
    .default([]),
});
type Content = { role: string; parts: Record<string, unknown>[] };

export class Assistant {
  private narrations: number[] = [];
  private requests: number[] = [];
  constructor(
    private readonly options: { key: string | null; model: string; fetcher?: typeof fetch },
  ) {}

  async chat(input: unknown, engine: Engine, now: number) {
    if (!this.options.key) throw new EngineError("assistant_unavailable", 503);
    const parsed = chatSchema.safeParse(input);
    if (!parsed.success)
      throw new EngineError("invalid_request", 400, parsed.error.issues[0]?.message);
    this.requests = this.requests.filter((t) => now - t < 60000);
    if (this.requests.length >= 20) throw new EngineError("rate_limited", 429);
    this.requests.push(now);
    const request = parsed.data;
    const cards: { type: string; data: Record<string, unknown> }[] = [];
    const contents: Content[] = request.history.map((h) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    }));
    contents.push({ role: "user", parts: [{ text: request.message }] });
    const signal = AbortSignal.timeout(8000);
    try {
      for (let round = 0; round < 4; round++) {
        const content = await this.generate(contents, signal, true);
        const calls = content.parts.filter((p) => p.functionCall);
        if (!calls.length)
          return { reply: content.parts.map((p) => p.text ?? "").join("\n"), cards };
        contents.push({ role: "model", parts: content.parts });
        const results: Record<string, unknown>[] = [];
        for (const part of calls.slice(0, 8)) {
          const call = part.functionCall;
          if (!call) continue;
          let data: unknown;
          if (call.name === "get_market") data = engine.status();
          else if (call.name === "get_decisions") data = engine.decisions();
          else if (call.name === "explain_decision")
            data = engine.decisions(1000).find((d) => d.id === call.args.id) ?? {
              error: "Decision not found",
            };
          else if (call.name === "get_arena") data = engine.arenaView();
          else if (call.name === "get_taker")
            data = request.address
              ? (engine
                  .takers(10000)
                  .find((t) => t.address.toLowerCase() === request.address?.toLowerCase()) ?? {
                  tier: "probation",
                })
              : { error: "Caller address required" };
          else if (call.name === "prepare_quote") {
            const prepared = preparedSwap.safeParse(call.args);
            data = prepared.success
              ? {
                  ...prepared.data,
                  intent: prepared.data,
                  requiresReview: true,
                  paper: true,
                  quoteSource: "engine SDK after interpretation; never model-generated",
                }
              : { error: "Invalid swap form" };
            if (prepared.success)
              cards.push({ type: "quote", data: data as Record<string, unknown> });
          } else data = { error: "Unknown read-only tool" };
          if (call.name === "get_market") cards.push({ type: "market", data: { status: data } });
          if (call.name === "explain_decision")
            cards.push({ type: "decision", data: { decision: data } });
          results.push({
            functionResponse: {
              name: call.name,
              ...(call.id ? { id: call.id } : {}),
              response: { result: data },
            },
          });
        }
        contents.push({ role: "user", parts: results });
      }
      throw new EngineError(
        "assistant_unavailable",
        503,
        "Assistant exceeded its read-only tool budget",
      );
    } catch (error) {
      if (signal.aborted) throw new EngineError("assistant_timeout", 504);
      if (error instanceof EngineError) throw error;
      throw new EngineError("assistant_unavailable", 503, "Assistant request failed");
    }
  }

  async narrate(decision: Decision, engine: Engine): Promise<void> {
    if (
      !this.options.key ||
      ![
        "taker_tier_change",
        "pause",
        "pair_halt",
        "spread_widen",
        "spread_narrow",
        "arb_opportunity",
      ].includes(decision.type)
    )
      return;
    const now = Date.now();
    this.narrations = this.narrations.filter((t) => now - t < 60000);
    if (this.narrations.length >= 20) return;
    this.narrations.push(now);
    try {
      const content = await this.generate(
        [
          {
            role: "user",
            parts: [
              {
                text: [
                  `Explain this paper market-making decision in one sentence, at most 25 `,
                  `words. Use only supplied facts. `,
                  `${JSON.stringify({ reason: decision.reason, inputs: decision.inputs })}`,
                ].join(""),
              },
            ],
          },
        ],
        AbortSignal.timeout(8000),
        false,
      );
      const text = content.parts
        .map((p) => p.text ?? "")
        .join(" ")
        .trim();
      if (text) await engine.narrate(decision.id, text);
    } catch {
      /* Narration must never stop trading or risk checks. */
    }
  }

  private async generate(contents: Content[], signal: AbortSignal, tools: boolean) {
    const response = await (this.options.fetcher ?? fetch)(
      [
        `https://generativelanguage.googleapis.com/v1beta/models/`,
        `${encodeURIComponent(this.options.model)}:generateContent`,
      ].join(""),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.options.key ?? "" },
        signal,
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [
              {
                text: SYSTEM_PROMPT,
              },
            ],
          },
          ...(tools ? { tools: [{ functionDeclarations: declarations }] } : {}),
          generationConfig: { maxOutputTokens: 700, temperature: 0.2 },
        }),
      },
    );
    if (!response.ok) throw new Error("Gemini request failed");
    const parsed = responseSchema.parse(await response.json());
    const content = parsed.candidates[0]?.content;
    if (!content) throw new Error("Gemini returned no content");
    return content;
  }
}
