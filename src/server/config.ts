import "server-only";
import { isProvider, providers, type Provider } from "@/shared/providers";
export const providerKeyNames: Record<Provider, string> = {
  vercel: "AI_GATEWAY_API_KEY",
  typesafe: "TYPESAFE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};
export function config() {
  const mode = process.env.AI_ACCESS_MODE || "byok_only";
  if (!["byok_only", "site_only", "both"].includes(mode))
    throw new Error("Invalid AI_ACCESS_MODE");
  const siteProvider = process.env.AI_SITE_PROVIDER || "vercel";
  if (!isProvider(siteProvider)) throw new Error("Invalid AI_SITE_PROVIDER");
  if (mode !== "byok_only" && !process.env[providerKeyNames[siteProvider]])
    throw new Error(`Site mode requires ${providerKeyNames[siteProvider]}`);
  return {
    mode,
    siteProvider,
    model: providers[siteProvider].model,
    repository: "https://github.com/spoonnotfound/soupbase",
  };
}
