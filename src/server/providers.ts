import "server-only";
import { experimental_evaluate as evaluate } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { providers, type Provider } from "@/shared/providers";

export type Questions = Record<
  string,
  { type: "choice"; instructions: string; criteria: Record<string, string> }
>;
export type Answers = Record<
  string,
  { choice: string; probabilities: Record<string, number> }
>;

export async function evaluateJev(
  provider: Provider,
  key: string,
  state: Parameters<typeof evaluate>[0]["state"],
  questions: Questions,
) {
  const model = providers[provider].model;
  const signal = AbortSignal.timeout(20000);
  if (provider === "vercel") {
    const gateway = createGateway({
      apiKey: key,
      fetch: async (url, init) => {
        if (new URL(String(url)).origin !== "https://ai-gateway.vercel.sh")
          throw new Error("Unexpected gateway origin");
        return fetch(url, { ...init, redirect: "error" });
      },
    });
    const result = await evaluate({
      model: gateway.evaluationModel(model),
      state,
      questions,
      maxRetries: 0,
      abortSignal: signal,
    });
    return {
      answers: result.answers as Answers,
      confidence: result.providerMetadata?.typesafe?.confidence as
        Record<string, number> | undefined,
      usage: result.usage,
    };
  }

  // Fixed destinations: credentials never follow redirects or fall back to another service.
  const url =
    provider === "typesafe"
      ? "https://api.typesafe.ai/v1/systemone"
      : "https://openrouter.ai/api/alpha/decisions";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      state,
      questions,
      ...(provider === "openrouter"
        ? { provider: { allow_fallbacks: false } }
        : {}),
    }),
    signal,
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error("Provider request failed"), {
      statusCode: response.status,
    });
  }
  const result = await response.json();
  if (
    !result ||
    typeof result.answers !== "object" ||
    !result.answers ||
    Array.isArray(result.answers)
  )
    throw new Error("Invalid provider response");
  const answers: Answers = {};
  const confidence: Record<string, number> = {};
  for (const id of Object.keys(questions)) {
    const answer = result.answers[id];
    if (!answer || typeof answer.choice !== "string")
      throw new Error("Invalid provider answer");
    answers[id] = {
      choice: answer.choice,
      probabilities:
        answer.probabilities && typeof answer.probabilities === "object"
          ? answer.probabilities
          : {},
    };
    // Missing or malformed confidence is handled conservatively by the game rules.
    const score = answer.confidence;
    if (
      typeof score === "number" &&
      Number.isFinite(score) &&
      score >= 0 &&
      score <= 1
    )
      confidence[id] = score;
  }
  const count = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : 0;
  return {
    answers,
    confidence,
    usage: {
      inputTokens: count(result.usage?.input_tokens),
      outputTokens: count(result.usage?.output_tokens),
    },
  };
}
