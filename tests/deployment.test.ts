import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("Vercel deployment", () => {
  it("builds buttons with variable names but no credential values", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "soup-deploy-"));
    try {
      const block = "<!-- vercel-deploy:start -->\n<!-- vercel-deploy:end -->";
      for (const file of ["README.md", "README.en.md"])
        writeFileSync(path.join(dir, file), block);
      const result = spawnSync(
        process.execPath,
        [path.resolve("scripts/deploy-button.mjs"), "example/soup"],
        {
          cwd: dir,
          encoding: "utf8",
          env: {
            NODE_ENV: "test",
            AI_GATEWAY_API_KEY: "synthetic-secret-not-for-urls",
          },
        },
      );
      expect(result.status).toBe(0);
      const text = readFileSync(path.join(dir, "README.md"), "utf8");
      expect(text).not.toContain("synthetic-secret-not-for-urls");
      const urls = [
        ...text.matchAll(/\]\((https:\/\/vercel.com\/new\/clone[^)]+)\)/g),
      ].map((m) => new URL(m[1]));
      expect(urls).toHaveLength(2);
      expect(urls[1].searchParams.get("env")).toBe("AI_ACCESS_MODE");
      expect(JSON.parse(urls[0].searchParams.get("products")!)).toEqual([
        {
          type: "integration",
          integrationSlug: "neon",
          productSlug: "neon",
          protocol: "storage",
        },
      ]);
      expect(urls[0].searchParams.get("repository-url")).toBe(
        "https://github.com/example/soup",
      );
      expect(urls[0].searchParams.get("env")).toContain("AI_GATEWAY_API_KEY");
      expect(urls[1].searchParams.get("env")).not.toContain(
        "AI_GATEWAY_API_KEY",
      );
      expect(JSON.parse(urls[0].searchParams.get("envDefaults")!)).toEqual({
        AI_ACCESS_MODE: "both",
      });
      expect(JSON.parse(urls[1].searchParams.get("envDefaults")!)).toEqual({
        AI_ACCESS_MODE: "byok_only",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [{}, "DATABASE_URL"],
    [
      { DATABASE_URL: "postgres://synthetic", AI_ACCESS_MODE: "both" },
      "AI_GATEWAY_API_KEY",
    ],
    [
      { DATABASE_URL: "postgres://synthetic", AI_ACCESS_MODE: "invalid" },
      "Invalid AI_ACCESS_MODE",
    ],
    [
      { DATABASE_URL: "postgres://synthetic", AI_SITE_PROVIDER: "invalid" },
      "Invalid AI_SITE_PROVIDER",
    ],
    [
      {
        DATABASE_URL: "postgres://synthetic",
        AI_ACCESS_MODE: "both",
        AI_SITE_PROVIDER: "typesafe",
        AI_GATEWAY_API_KEY: "synthetic-vercel",
      },
      "TYPESAFE_API_KEY",
    ],
    [
      {
        DATABASE_URL: "postgres://synthetic",
        AI_ACCESS_MODE: "site_only",
        AI_SITE_PROVIDER: "openrouter",
      },
      "OPENROUTER_API_KEY",
    ],
  ])(
    "rejects incomplete Vercel configuration before building",
    (extra, expected) => {
      const result = spawnSync(process.execPath, ["scripts/vercel-build.mjs"], {
        encoding: "utf8",
        env: {
          NODE_ENV: "production",
          VERCEL: "1",
          VERCEL_ENV: "production",
          ...extra,
        },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(expected);
      expect(result.stderr).not.toContain("postgres://synthetic");
    },
  );
});
