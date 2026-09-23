import { spawnSync } from "node:child_process";

// Each Vercel environment must use its own integration-provisioned database.
const setup = process.env.VERCEL === "1";
function fail(message) {
  console.error(message);
  process.exit(1);
}
if (process.env.VERCEL === "1") {
  if (!process.env.DATABASE_URL)
    fail("Set DATABASE_URL in Vercel Environment Variables.");
  const mode = process.env.AI_ACCESS_MODE || "byok_only";
  if (!["byok_only", "site_only", "both"].includes(mode))
    fail("Invalid AI_ACCESS_MODE.");
  const provider = process.env.AI_SITE_PROVIDER || "vercel";
  const keys = {
    vercel: "AI_GATEWAY_API_KEY",
    typesafe: "TYPESAFE_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };
  if (!Object.hasOwn(keys, provider)) fail("Invalid AI_SITE_PROVIDER.");
  if (mode !== "byok_only" && !process.env[keys[provider]])
    fail(
      `Site access requires ${keys[provider]} in Vercel Environment Variables.`,
    );
}
if (setup && !process.env.DATABASE_URL)
  fail("Database setup requires DATABASE_URL.");
const build = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build"],
  { stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status || 1);
if (setup) {
  for (const file of ["migrate.ts", "sync-content.ts"]) {
    const result = spawnSync(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", `scripts/${file}`],
      { encoding: "utf8" },
    );
    // Database failures can include connection details. Keep raw errors out of build logs.
    if (result.status !== 0)
      fail(
        `Database setup failed in ${file}. Check connectivity and permissions; raw database errors are withheld.`,
      );
  }
  console.log("Database initialized and public puzzle catalog synced.");
} else {
  console.log(
    "Database setup skipped. Initialize this environment separately before use.",
  );
}
