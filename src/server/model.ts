import "server-only";
import { AppError } from "./access";
import { config, providerKeyNames } from "./config";
import { evaluateJev, type Questions } from "./providers";
import { providers, type Provider } from "@/shared/providers";
import { guessQuestions, gradeGuess } from "./guess";
import { hostQuestions, hostState } from "./host";
import {
  CONFIDENCE_THRESHOLD,
  HOST_UNCERTAIN_THRESHOLD,
} from "@/shared/confidence";
import { decisions, type Decision, type PuzzleInput } from "@/shared/puzzle";
export function selectCredentials(
  source: string,
  byok: string | null,
  provider: Provider = "vercel",
) {
  const c = config();
  if (source === "site") {
    if (c.mode === "byok_only") throw new AppError("site_disabled", 403);
    return {
      provider: c.siteProvider,
      key: process.env[providerKeyNames[c.siteProvider]]!,
    };
  }
  if (source === "byok") {
    if (c.mode === "site_only") throw new AppError("byok_disabled", 403);
    if (!byok || byok.length < 12 || byok.length > 512 || /[\r\n]/.test(byok))
      throw new AppError("key_required", 401);
    return { provider, key: byok };
  }
  throw new AppError("invalid_source", 422);
}
/**
 * Jev only picks between yes/no/irrelevant. "uncertain" is derived here: a missing,
 * malformed or too-even confidence distribution never becomes a concrete answer.
 */
export function hostDecision(answer: unknown, confidence: unknown): Decision {
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < HOST_UNCERTAIN_THRESHOLD ||
    confidence > 1
  )
    return "uncertain";
  const choice = (answer as { choice?: unknown } | null)?.choice;
  if (typeof choice !== "string" || !decisions.includes(choice as Decision))
    throw new AppError("upstream_failed", 502);
  return choice as Decision;
}
export async function judge(
  p: PuzzleInput,
  input: string,
  history: { input: string }[],
  kind: string,
  key: string,
  provider: Provider = "vercel",
) {
  const questions: Questions =
    kind === "guess" ? guessQuestions(p) : hostQuestions();
  const state = hostState(p, input, kind === "guess" ? [] : history);
  try {
    const r = await evaluateJev(provider, key, state, questions);
    const { confidence, answers } = r;
    return {
      decision:
        kind === "guess"
          ? gradeGuess(
              p.facts.filter((f) => f.required).map((f) => f.id),
              answers,
              confidence,
            )
          : hostDecision(answers?.answer, confidence?.answer),
      metadata: {
        trace: {
          request: {
            provider,
            model: providers[provider].model,
            state,
            questions,
            maxRetries: 0,
            timeoutMs: 20000,
          },
          // Explicit allowlist: never persist transport headers or provider error bodies.
          response: {
            answers: Object.fromEntries(
              Object.entries(questions).map(([id, q]) => {
                const answer = answers?.[id];
                return [
                  id,
                  {
                    choice:
                      answer && Object.hasOwn(q.criteria, answer.choice)
                        ? answer.choice
                        : null,
                    probabilities: Object.fromEntries(
                      Object.keys(q.criteria).flatMap((choice) => {
                        const value = answer?.probabilities?.[choice];
                        return typeof value === "number" &&
                          Number.isFinite(value) &&
                          value >= 0 &&
                          value <= 1
                          ? [[choice, value]]
                          : [];
                      }),
                    ),
                  },
                ];
              }),
            ),
            confidence: Object.fromEntries(
              Object.keys(questions).map((id) => {
                const value = confidence?.[id];
                return [
                  id,
                  typeof value === "number" &&
                  Number.isFinite(value) &&
                  value >= 0 &&
                  value <= 1
                    ? value
                    : null,
                ];
              }),
            ),
            usage: {
              inputTokens: r.usage.inputTokens,
              outputTokens: r.usage.outputTokens,
            },
          },
        },
        provider,
        model: providers[provider].model,
        confidence: confidence || null,
        confidenceThreshold:
          kind === "guess" ? CONFIDENCE_THRESHOLD : HOST_UNCERTAIN_THRESHOLD,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
      },
    };
  } catch (e: unknown) {
    if (e instanceof AppError) throw e;
    const status = (e as { statusCode?: number }).statusCode;
    throw new AppError(
      status === 401 || status === 403
        ? "key_rejected"
        : status === 402
          ? "provider_credits_exhausted"
          : status === 429
            ? "provider_rate_limit"
            : "upstream_failed",
      status === 429
        ? 429
        : status === 402
          ? 402
          : status === 401 || status === 403
            ? 401
            : 502,
    );
  }
}
