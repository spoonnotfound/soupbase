# Soupbase

A text-focused, bilingual lateral-thinking puzzle game hosted by Jev. Ask questions, reveal hints, submit an explanation, or create a private puzzle and share a revocable play link.

Powered by [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) from [TypeSafe AI](https://typesafe.ai/), through the official TypeSafe API, OpenRouter or Vercel AI Gateway. Jev evaluates player questions and explanations, returning structured choices, probabilities and confidence that the app uses to display answers and determine outcomes.

[中文](README.md) · [Deployment](docs/deployment.md) · [Architecture](docs/architecture.md) · [Security](docs/security.md)

## Deploy to Vercel

<!-- vercel-deploy:start -->
Site key + BYOK (enter your own key during deployment):

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fspoonnotfound%2Fsoupbase&env=AI_ACCESS_MODE%2CAI_GATEWAY_API_KEY&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D&envDefaults=%7B%22AI_ACCESS_MODE%22%3A%22both%22%7D&envDescription=Connect+Neon+Postgres+in+the+deployment+flow.+Choose+AI_ACCESS_MODE%3B+site+mode+also+requires+your+own+Vercel+AI+Gateway+key.&envLink=https%3A%2F%2Fgithub.com%2Fspoonnotfound%2Fsoupbase%2Fblob%2FHEAD%2Fdocs%2Fdeployment.md)

BYOK only (no site key required):

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fspoonnotfound%2Fsoupbase&env=AI_ACCESS_MODE&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D&envDefaults=%7B%22AI_ACCESS_MODE%22%3A%22byok_only%22%7D&envDescription=Connect+Neon+Postgres+in+the+deployment+flow.+Choose+AI_ACCESS_MODE%3B+site+mode+also+requires+your+own+Vercel+AI+Gateway+key.&envLink=https%3A%2F%2Fgithub.com%2Fspoonnotfound%2Fsoupbase%2Fblob%2FHEAD%2Fdocs%2Fdeployment.md)
<!-- vercel-deploy:end -->

## Run locally

Requires Node.js 24 and npm.

```sh
npm ci
cp .env.example .env.local
npm run content:sync
npm run dev
```

Open [localhost:3000/en](http://localhost:3000/en). Local development uses PGlite in the ignored `.data/postgres` directory. Stop the dev server before running database maintenance or content sync against this directory. Production requires PostgreSQL.

The default is BYOK: choose **TypeSafe AI, OpenRouter or Vercel AI Gateway** in Settings and enter that service's key. It is held in page memory and cleared on refresh or provider changes. Model calls incur provider charges. Browsing, authoring, hints and revealing the solution do not need a model key.

The deployment buttons provision Neon Postgres inside Vercel and inject `DATABASE_URL`. Choose `AI_ACCESS_MODE` and enter your own `AI_GATEWAY_API_KEY` for site access. The origin is inferred from each request; no domain setting is needed. Builds initialize and sync the connected database. Preview environments must use isolated databases and credentials.

## Features and configuration

- Chinese/English UI, light/dark themes, saved games, hints and explanation checks.
- Three host answers: Yes, No, Irrelevant. When the model has no clear preference (confidence < 0.45) the result becomes "cannot determine", with native confidence.
- Private browser authoring and revocable link sharing; no file uploads or import/export. Sharing never publishes to the public catalog.
- `AI_ACCESS_MODE`: `byok_only` (default), `site_only`, or `both`. Switch to `byok_only` and redeploy to disable hosted access for that deployment.
- Lost responses are recovered by reading the original request. Repeated submissions reuse its ID; model calls are never automatically retried or sent to another service. Failed requests require an explicit new attempt.

`AI_SITE_PROVIDER` selects the hosted provider independently of each BYOK player's selection. Only the selected provider's server key is required; credentials never silently fall back.

| `AI_SITE_PROVIDER` | Server key | Model |
| --- | --- | --- |
| `vercel` (default) | `AI_GATEWAY_API_KEY` | `typesafe-ai/jev` |
| `typesafe` | `TYPESAFE_API_KEY` | `jev-1.13.0` |
| `openrouter` | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` |

The deployment buttons default to Vercel AI Gateway for hosted access. See [deployment](docs/deployment.md) to switch to the official API or OpenRouter.

There are no accounts, anonymous daily quotas, moderation queues or Star-based unlocks. Site-key usage budgets are the operator's responsibility.

BYOK requests pass through the deployment server, which can read the key. The application does not persist or intentionally log it; open source does not prove a remote deployment runs identical code. See [security boundaries](docs/security.md).

## Puzzle catalog

Puzzles live in `content/puzzles/zh/` and `content/puzzles/en/`, one JSON file per puzzle. Each file has a stable `id` and the fields defined in `src/shared/puzzle.ts`. Add a file, run `npm run content:check`, then `npm run content:sync`. Keep the same ID when editing; existing games retain their original revision.


The catalog contains 50 distinct stories (14 easy, 25 medium, 11 hard), with matching Chinese and English versions. The latest expansion adds 39 stories to the previous 11. Each curated adaptation includes three hints, two core solution facts and source attribution.


## Development

```sh
npm run content:check
npm run typecheck
npm test
npm run build
```

Tests use isolated databases and a mock model, without API credentials or paid calls. They do not establish model accuracy. The stack is Next.js, React, TypeScript, PostgreSQL/PGlite and Vercel AI SDK.

## License

[MIT](LICENSE) for code. The 3 original sample stories use CC0 1.0; the 47 curated adaptations and their translations use CC BY-SA 4.0 with source attribution. All 50 stories have Chinese and English versions (100 JSON files). See the [content license](content/LICENSE.md) and [50-story expansion notes](docs/curation-2026-09-22-50.md), or expand “Source and license” in a game. These licenses do not automatically apply to privately authored user puzzles.
