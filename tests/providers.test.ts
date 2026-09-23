import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateJev } from "../src/server/providers";
import { config } from "../src/server/config";
import { judge, selectCredentials } from "../src/server/model";
import { providers } from "../src/shared/providers";
import { puzzleSchema } from "../src/shared/puzzle";
import doorbell from "../content/puzzles/zh/doorbell.json";
const { id: _id, ...content } = doorbell;
const puzzle = puzzleSchema.parse(content);
const questions = {
  answer: {
    type: "choice" as const,
    instructions: "Is it true?",
    criteria: { yes: "Yes", no: "No" },
  },
};
const state = { player_input: "A synthetic question" };
const payload = {
  model: "jev-1.13.0",
  answers: {
    answer: {
      type: "choice",
      choice: "yes",
      confidence: 0.93,
      probabilities: { yes: 0.97, no: 0.03 },
    },
  },
  usage: { input_tokens: 123, output_tokens: 4 },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Jev providers", () => {
  it.each([
    ["typesafe", "https://api.typesafe.ai/v1/systemone"],
    ["openrouter", "https://openrouter.ai/api/alpha/decisions"],
  ] as const)(
    "uses %s's documented endpoint, model and native confidence",
    async (provider, url) => {
      const fetch = vi.fn(async () => Response.json(payload));
      vi.stubGlobal("fetch", fetch);
      const result = await evaluateJev(
        provider,
        "synthetic-provider-key",
        state,
        questions,
      );
      expect(result).toEqual({
        answers: {
          answer: { choice: "yes", probabilities: { yes: 0.97, no: 0.03 } },
        },
        confidence: { answer: 0.93 },
        usage: { inputTokens: 123, outputTokens: 4 },
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [endpoint, init] = fetch.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(endpoint).toBe(url);
      expect(init.headers).toEqual({
        Authorization: "Bearer synthetic-provider-key",
        "Content-Type": "application/json",
      });
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(init.body as string)).toEqual({
        model: providers[provider].model,
        state,
        questions,
        ...(provider === "openrouter"
          ? { provider: { allow_fallbacks: false } }
          : {}),
      });
    },
  );

  it.each(["typesafe", "openrouter"] as const)(
    "keeps %s credentials and untrusted fields out of persisted results",
    async (provider) => {
      const secret = "synthetic-secret-never-persist";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            ...payload,
            debug: secret,
            answers: {
              answer: {
                ...payload.answers.answer,
                debug: secret,
                probabilities: { yes: 0.97, [secret]: 0.03 },
              },
            },
          }),
        ),
      );
      const result = await judge(
        puzzle,
        "A question",
        [],
        "question",
        secret,
        provider,
      );
      expect(result.decision).toBe("yes");
      expect(result.metadata.provider).toBe(provider);
      expect(result.metadata.confidence!.answer).toBe(0.93);
      expect(result.metadata.inputTokens).toBe(123);
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it.each([401, 402, 429, 500])(
    "maps HTTP %s without leaking error bodies or retrying",
    async (status) => {
      const fetch = vi.fn(
        async () => new Response("synthetic-secret", { status }),
      );
      vi.stubGlobal("fetch", fetch);
      const code =
        status === 401
          ? "key_rejected"
          : status === 402
            ? "provider_credits_exhausted"
            : status === 429
              ? "provider_rate_limit"
              : "upstream_failed";
      await expect(
        judge(
          puzzle,
          "A question",
          [],
          "question",
          "synthetic-secret",
          "typesafe",
        ),
      ).rejects.toMatchObject({ code });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not retry an ambiguous network failure or send the key to another service", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });
    vi.stubGlobal("fetch", fetch);
    await expect(
      judge(
        puzzle,
        "A question",
        [],
        "question",
        "synthetic-key",
        "openrouter",
      ),
    ).rejects.toMatchObject({ code: "upstream_failed" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, "0.99", -1, 1.01])(
    "treats malformed native confidence %s as uncertain",
    async (confidence) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            ...payload,
            answers: { answer: { ...payload.answers.answer, confidence } },
          }),
        ),
      );
      expect(
        (
          await judge(
            puzzle,
            "A question",
            [],
            "question",
            "synthetic-key",
            "typesafe",
          )
        ).decision,
      ).toBe("uncertain");
    },
  );

  it("keeps native explanation grading behind the existing confidence threshold", async () => {
    let confidence = 0.69;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        return Response.json({
          answers: Object.fromEntries(
            Object.keys(body.questions).map((id) => [
              id,
              {
                choice: id === "coherence" ? "coherent" : "supported",
                confidence,
                probabilities: {},
              },
            ]),
          ),
          usage: payload.usage,
        });
      }),
    );
    expect(
      (
        await judge(
          puzzle,
          "Explanation",
          [],
          "guess",
          "synthetic-key",
          "typesafe",
        )
      ).decision,
    ).toBe("uncertain");
    confidence = 0.99;
    expect(
      (
        await judge(
          puzzle,
          "Explanation",
          [],
          "guess",
          "synthetic-key",
          "openrouter",
        )
      ).decision,
    ).toBe("solved");
  });

  it("selects hosted keys only on the server and keeps BYOK independent", () => {
    vi.stubEnv("AI_ACCESS_MODE", "both");
    vi.stubEnv("AI_SITE_PROVIDER", "typesafe");
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic-official-site-key");
    vi.stubEnv("AI_GATEWAY_API_KEY", "synthetic-old-vercel-key");
    expect(selectCredentials("site", null, "openrouter")).toEqual({
      provider: "typesafe",
      key: "synthetic-official-site-key",
    });
    expect(
      selectCredentials("byok", "synthetic-openrouter-key", "openrouter"),
    ).toEqual({ provider: "openrouter", key: "synthetic-openrouter-key" });
    expect(JSON.stringify(config())).not.toContain("synthetic-");
    vi.stubEnv("AI_ACCESS_MODE", "byok_only");
    expect(() => selectCredentials("site", null)).toThrow("site_disabled");
    vi.stubEnv("AI_ACCESS_MODE", "site_only");
    expect(() => selectCredentials("byok", "synthetic-byok-key")).toThrow(
      "byok_disabled",
    );
  });

  it("does not substitute a Vercel key when the selected official key is absent", () => {
    vi.stubEnv("AI_ACCESS_MODE", "both");
    vi.stubEnv("AI_SITE_PROVIDER", "typesafe");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "synthetic-vercel-key");
    expect(() => config()).toThrow("TYPESAFE_API_KEY");
  });
});
