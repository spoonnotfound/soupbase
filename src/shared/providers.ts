export const providers = {
  vercel: { name: "Vercel AI Gateway", model: "typesafe-ai/jev" },
  typesafe: { name: "TypeSafe AI", model: "jev-1.13.0" },
  openrouter: { name: "OpenRouter", model: "typesafe/jev-1.13" },
} as const;

export type Provider = keyof typeof providers;
export const providerIds = ["vercel", "typesafe", "openrouter"] as const;
export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && Object.hasOwn(providers, value);
}
