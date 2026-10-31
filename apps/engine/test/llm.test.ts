import { expect, test } from "bun:test";
import { Assistant } from "../src/llm";
import { readyEngine } from "./helpers";

test("assistant is unavailable without credentials and cannot execute a swap", async () => {
  const { engine, now } = await readyEngine();
  await expect(
    new Assistant({ key: null, model: "test" }).chat({}, engine, now),
  ).rejects.toMatchObject({ code: "assistant_unavailable" });
  let round = 0;
  const assistant = new Assistant({
    key: "test-key",
    model: "test",
    fetcher: (async (_input: unknown, init?: RequestInit) => {
      round++;
      if (round === 2) {
        const sent = JSON.parse(String(init?.body));
        expect(sent.contents[1].parts[0]).toMatchObject({
          functionCall: { id: "call-1", name: "prepare_quote" },
          thoughtSignature: "test-thought",
        });
        expect(sent.contents[2].parts[0]).toMatchObject({
          functionResponse: { id: "call-1", name: "prepare_quote" },
        });
        expect(sent.contents[2].parts[1].functionResponse.response.result).toEqual({
          error: "Unknown read-only tool",
        });
      }
      return Response.json({
        candidates: [
          {
            content: {
              parts:
                round === 1
                  ? [
                      {
                        functionCall: {
                          id: "call-1",
                          name: "prepare_quote",
                          args: { pair: "HSK/USDT", side: "buy", amount: "100" },
                        },
                        thoughtSignature: "test-thought",
                      },
                      { functionCall: { name: "execute_swap", args: {} } },
                    ]
                  : [{ text: "I prepared the paper swap form. Review it before filling." }],
            },
          },
        ],
      });
    }) as unknown as typeof fetch,
  });
  const response = await assistant.chat(
    { role: "user", message: "Swap 100 USDT to HSK" },
    engine,
    now,
  );
  expect(response.cards[0]).toMatchObject({
    type: "quote",
    data: { amount: "100", requiresReview: true, paper: true },
  });
  expect(engine.arenaView().fills).toBe(0);
  expect(engine.status().paused).toBe(false);
});
