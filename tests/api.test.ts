import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const mocked = vi.hoisted(() => ({
  keys: [] as string[],
  failure: 0,
  delay: 0,
  guessChoices: {} as Record<string, string>,
  guessConfidence: 0.99,
  guessHistory: undefined as unknown,
  hostChoice: "yes",
  hostConfidence: 0.99 as unknown,
  hostState: undefined as unknown,
  hostOptions: [] as string[],
}));
vi.mock("@ai-sdk/gateway", () => ({
  createGateway: ({ apiKey }: { apiKey: string }) => ({
    evaluationModel: () => ({ key: apiKey }),
  }),
}));
vi.mock("ai", () => ({
  experimental_evaluate: async ({
    model,
    questions,
    state,
  }: {
    model: { key: string };
    questions: Record<string, unknown>;
    state: { history: unknown };
  }) => {
    mocked.keys.push(model.key);
    if (mocked.delay) await new Promise((r) => setTimeout(r, mocked.delay));
    if (mocked.failure)
      throw { statusCode: mocked.failure, message: "secret " + model.key };
    if (questions.coherence) {
      mocked.guessHistory = state.history;
      return {
        answers: Object.fromEntries(
          Object.keys(questions).map((id) => [
            id,
            {
              choice:
                mocked.guessChoices[id] ||
                (id === "coherence" ? "coherent" : "supported"),
              probabilities: {},
            },
          ]),
        ),
        providerMetadata: {
          typesafe: {
            confidence: Object.fromEntries(
              Object.keys(questions).map((id) => [id, mocked.guessConfidence]),
            ),
          },
        },
        usage: { inputTokens: 100, outputTokens: 1 },
      };
    }
    mocked.hostState = state;
    mocked.hostOptions = Object.keys(
      (questions.answer as { criteria: object }).criteria,
    );
    return {
      answers: { answer: { choice: mocked.hostChoice, probabilities: {} } },
      providerMetadata: {
        typesafe: { confidence: { answer: mocked.hostConfidence } },
      },
      usage: { inputTokens: 100, outputTokens: 1 },
    };
  },
}));
import { handle } from "../src/server/api";
import { query, sql } from "../src/server/db";
import { hostDecision } from "../src/server/model";
import { readCatalog } from "../scripts/catalog";
import doorbell from "../content/puzzles/zh/doorbell.json";
const { id: _puzzleId, ...puzzleContent } = doorbell;
const origin = "http://localhost:3100";
class Client {
  cookie = "";
  async request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
    requestOrigin = origin,
  ) {
    const response = await handle(
      new NextRequest(origin + "/api/" + path, {
        method,
        headers: {
          origin: requestOrigin,
          "content-type": "application/json",
          cookie: this.cookie,
          ...(key ? { authorization: "Bearer " + key } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      path.split("/"),
    );
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    return {
      status: response.status,
      data: await response.json(),
      headers: response.headers,
    };
  }
}
const author = new Client(),
  player = new Client(),
  stranger = new Client();
let puzzleId: string, management: string, sessionId: string;
beforeAll(async () => {
  await mkdir(".data", { recursive: true });
  process.env.LOCAL_DB_PATH = ".data/test-" + randomUUID();
  delete process.env.DATABASE_URL;
  process.env.AI_ACCESS_MODE = "byok_only";
});
describe("resource access and gameplay", () => {
  it("exposes only public puzzle fields", async () => {
    const r = await player.request("puzzles");
    expect(r.status).toBe(200);
    const catalog = await readCatalog();
    expect(r.data.map((p: { id: string }) => p.id).sort()).toEqual(
      catalog.map((p) => p.id).sort(),
    );
    for (const puzzle of r.data) {
      expect(Object.keys(puzzle).sort()).toEqual(
        [
          "id",
          "revision",
          "visibility",
          "title",
          "surface",
          "language",
          "difficulty",
          "tags",
          "source",
          "hintTotal",
        ].sort(),
      );
      const entry = catalog.find((p) => p.id === puzzle.id)!;
      expect(puzzle.source).toEqual(entry.puzzle.source);
      expect(JSON.stringify(puzzle)).not.toContain(entry.puzzle.solution);
    }
  });
  it("creates privately and refuses permission fields", async () => {
    const bad = await author.request("puzzles", "POST", {
      ...puzzleContent,
      visibility: "curated",
    });
    expect(bad.status).toBe(422);
    const r = await author.request("puzzles", "POST", puzzleContent);
    expect(r.status).toBe(201);
    puzzleId = r.data.id;
    management = r.data.manageKey;
    expect((await stranger.request("puzzles/" + puzzleId)).status).toBe(404);
    expect(
      (await author.request("puzzles/" + puzzleId + "/export")).data.content
        .solution,
    ).toBe(puzzleContent.solution);
  });
  it("separates sharing from management", async () => {
    const r = await author.request(`puzzles/${puzzleId}/share`, "POST", {});
    expect(
      (
        await player.request("access/exchange", "POST", {
          id: puzzleId,
          role: "play",
          secret: r.data.shareKey,
        })
      ).status,
    ).toBe(200);
    expect(
      (await player.request("puzzles/" + puzzleId + "/export")).status,
    ).toBe(404);
    const g = await player.request("sessions", "POST", { puzzleId });
    expect(g.status).toBe(201);
    sessionId = g.data.id;
    // Link access must never turn a custom puzzle into a public listing.
    for (const client of [author, player, stranger]) {
      const catalog = await client.request("puzzles");
      expect(
        catalog.data.some((entry: { id: string }) => entry.id === puzzleId),
      ).toBe(false);
    }
    expect((await stranger.request("puzzles/" + puzzleId)).status).toBe(404);
    expect(
      (await stranger.request("sessions", "POST", { puzzleId })).status,
    ).toBe(404);
    expect(g.data.solution).toBeUndefined();
    expect(g.data.hints).toEqual([]);
    expect((await stranger.request("sessions/" + sessionId)).status).toBe(404);
  });
  it("unlocks one hint per unique request, without returning later hints", async () => {
    const req = { clientRequestId: randomUUID() };
    const a = await player.request(`sessions/${sessionId}/hints`, "POST", req);
    const b = await player.request(`sessions/${sessionId}/hints`, "POST", req);
    expect(a.data.hints).toHaveLength(1);
    expect(b.data.hints).toHaveLength(1);
    expect(JSON.stringify(b.data)).not.toContain(puzzleContent.hints[2]);
  });
  it("keeps BYOK per request, persists no canary, and deduplicates successful calls", async () => {
    const body = {
      text: "他看到了灯吗？",
      clientRequestId: randomUUID(),
      credentialSource: "byok",
    };
    const key = "canary-secret-alpha-never-persist";
    const r = await player.request(
      `sessions/${sessionId}/questions`,
      "POST",
      body,
      key,
    );
    expect(r.status).toBe(200);
    expect(r.data.turns[0].decision).toBe("yes");
    expect(r.data.turns[0].confidence).toEqual({
      score: 0.99,
      threshold: null,
      checks: [{ kind: "answer", score: 0.99 }],
    });
    expect(r.data.turns[0]).not.toHaveProperty("metadata");
    expect(r.data.turns[0].response.answers.answer.choice).toBe("yes");
    expect(r.data.turns[0].response.confidence.answer).toBe(0.99);
    expect(JSON.stringify(r.data)).not.toContain(puzzleContent.solution);
    expect(JSON.stringify(r.data)).not.toContain('"request":');
    expect((await player.request(`sessions/${sessionId}/trace`)).status).toBe(
      409,
    );
    expect((await stranger.request(`sessions/${sessionId}/trace`)).status).toBe(
      404,
    );
    expect(mocked.keys.at(-1)).toBe(key);
    const count = mocked.keys.length;
    await player.request(`sessions/${sessionId}/questions`, "POST", body, key);
    expect(mocked.keys).toHaveLength(count);
    const rows = await query(sql`SELECT * FROM turns`);
    expect(JSON.stringify(rows)).not.toContain(key);
    expect(JSON.stringify(r.data)).not.toContain(key);
  });
  it("isolates two concurrent users and keys", async () => {
    const a = new Client(),
      b = new Client();
    const ga = await a.request("sessions", "POST", { puzzleId: "sample-1" }),
      gb = await b.request("sessions", "POST", { puzzleId: "sample-1" });
    mocked.delay = 30;
    const result = await Promise.all(
      [
        [a, ga.data.id, "canary-key-for-alpha"],
        [b, gb.data.id, "canary-key-for-beta"],
      ].map(async ([c, id, key]) =>
        (c as Client).request(
          `sessions/${id}/questions`,
          "POST",
          {
            text: "是真的吗？",
            clientRequestId: randomUUID(),
            credentialSource: "byok",
          },
          key as string,
        ),
      ),
    );
    mocked.delay = 0;
    expect(result.map((x) => x.status)).toEqual([200, 200]);
    expect(mocked.keys.slice(-2).sort()).toEqual([
      "canary-key-for-alpha",
      "canary-key-for-beta",
    ]);
  });
  it("never leaks provider error bodies or silently retries", async () => {
    for (const status of [401, 429, 500]) {
      mocked.failure = status;
      const key = "canary-error-secret-" + status;
      const before = mocked.keys.length;
      const r = await player.request(
        `sessions/${sessionId}/questions`,
        "POST",
        {
          text: "门铃响了吗？",
          clientRequestId: randomUUID(),
          credentialSource: "byok",
        },
        key,
      );
      expect(r.status).toBe(status === 500 ? 502 : status);
      expect(JSON.stringify(r.data)).not.toContain(key);
      expect(mocked.keys.length).toBe(before + 1);
      expect(
        JSON.stringify(await query(sql`SELECT * FROM turns`)),
      ).not.toContain(key);
    }
    mocked.failure = 0;
  });
  it("fixes existing games to their original revision", async () => {
    const old = await author.request("puzzles/" + puzzleId + "/export");
    const changed = { ...puzzleContent, solution: "A new solution." };
    expect(
      (
        await author.request("puzzles/" + puzzleId, "PATCH", {
          content: changed,
          baseRevision: old.data.revision,
        })
      ).status,
    ).toBe(200);
    const r = await player.request(`sessions/${sessionId}/reveal`, "POST", {});
    expect(r.data.solution).toBe(puzzleContent.solution);
    const trace = await player.request(`sessions/${sessionId}/trace`);
    expect(trace.status).toBe(200);
    expect(trace.data.turns[0].trace.request.state.reference.solution).toBe(
      puzzleContent.solution,
    );
    expect(trace.data.turns[0].trace.request.state.player_input).toBe(
      "他看到了灯吗？",
    );
    expect(trace.data.turns[0].trace.request.questions.answer.type).toBe(
      "choice",
    );
    expect(trace.data.turns[0].trace.response.answers.answer.choice).toBe(
      "yes",
    );
    expect(JSON.stringify(trace.data)).not.toContain(
      "canary-secret-alpha-never-persist",
    );
    expect((await stranger.request(`sessions/${sessionId}/trace`)).status).toBe(
      404,
    );
    expect(
      (
        await player.request(
          `sessions/${sessionId}/questions`,
          "POST",
          {
            text: "a",
            clientRequestId: randomUUID(),
            credentialSource: "byok",
          },
          "valid-canary-key",
        )
      ).status,
    ).toBe(409);
  });
  it("revokes existing play grants and games", async () => {
    await author.request(`puzzles/${puzzleId}/share`, "DELETE", {});
    expect((await player.request("sessions/" + sessionId)).status).toBe(404);
    expect((await player.request("puzzles/" + puzzleId)).status).toBe(404);
  });
  it("recovers management and revokes old management links", async () => {
    const other = new Client();
    expect(
      (
        await other.request("access/exchange", "POST", {
          id: puzzleId,
          role: "manage",
          secret: management,
        })
      ).status,
    ).toBe(200);
    expect(
      (await other.request("puzzles/" + puzzleId + "/export")).status,
    ).toBe(200);
    await author.request(`puzzles/${puzzleId}/manage-key`, "POST", {});
    expect(
      (await other.request("puzzles/" + puzzleId + "/export")).status,
    ).toBe(404);
  });
  it("blocks cross-origin mutation and oversized bodies", async () => {
    expect(
      (
        await author.request(
          "puzzles",
          "POST",
          puzzleContent,
          undefined,
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect(
      (await author.request("puzzles", "POST", { data: "a".repeat(66000) }))
        .status,
    ).toBe(413);
  });
  it("accepts deployment domains without configuration but rejects foreign origins", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      for (const domain of [
        "https://soup-preview.vercel.app",
        "https://soup.example",
      ]) {
        for (const incoming of [domain, "https://evil.example"]) {
          const response = await handle(
            new NextRequest(`${domain}/api/puzzles`, {
              method: "POST",
              headers: { origin: incoming, "content-type": "application/json" },
              body: JSON.stringify(puzzleContent),
            }),
            ["puzzles"],
          );
          expect(response.status).toBe(incoming === domain ? 201 : 403);
        }
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("derives uncertain from confidence and rejects malformed provider results", () => {
    expect(hostDecision({ choice: "yes" }, 0.99)).toBe("yes");
    expect(hostDecision({ choice: "no" }, 0.99)).toBe("no");
    expect(hostDecision({ choice: "irrelevant" }, 0.99)).toBe("irrelevant");
    for (const confidence of [
      undefined,
      null,
      NaN,
      Infinity,
      -1,
      1.01,
      "0.99",
      0.449,
    ])
      expect(hostDecision({ choice: "yes" }, confidence)).toBe("uncertain");
    expect(hostDecision({ choice: "yes" }, 0.45)).toBe("yes");
    expect(hostDecision({ choice: "yes" }, 0.451)).toBe("yes");
    for (const answer of [
      undefined,
      null,
      {},
      { choice: "low_confidence" },
      { choice: "secret solution" },
    ]) {
      expect(() => hostDecision(answer, 0.99)).toThrow("upstream_failed");
    }
  });
  it("uses three choices, ignores legacy relevance hints, and normalizes old history", async () => {
    const client = new Client();
    const r = await client.request("puzzles", "POST", {
      ...puzzleContent,
      irrelevant_topics: ["门铃是否发声"],
    });
    expect(r.status).toBe(201);
    const exported = await client.request(`puzzles/${r.data.id}/export`);
    expect(exported.data.content).not.toHaveProperty("irrelevant_topics");
    const game = await client.request("sessions", "POST", {
      puzzleId: r.data.id,
    });
    mocked.hostChoice = "irrelevant";
    const response = await client.request(
      `sessions/${game.data.id}/questions`,
      "POST",
      {
        text: "墙壁是白色的吗？",
        clientRequestId: randomUUID(),
        credentialSource: "byok",
      },
      "canary-question-key",
    );
    mocked.hostChoice = "yes";
    expect(response.data.turns.at(-1).decision).toBe("irrelevant");
    expect(mocked.hostOptions).toEqual(["yes", "no", "irrelevant"]);
    expect(
      (mocked.hostState as { reference: object }).reference,
    ).not.toHaveProperty("irrelevant_topics");
    const turnId = response.data.turns.at(-1).id;
    for (const legacy of [
      "unknown",
      "ambiguous",
      "split",
      "invalid",
      "uncertain",
    ]) {
      await query(
        sql`UPDATE turns SET decision=${legacy},metadata=${JSON.stringify({ confidence: { answer: 0.82 } })}::jsonb WHERE id=${turnId}`,
      );
      const restored = await client.request(`sessions/${game.data.id}`);
      expect(restored.data.turns.at(-1).decision).toBe("uncertain");
      expect(restored.data.turns.at(-1).confidence.threshold).toBe(0.9);
      expect(restored.data.turns.at(-1)).not.toHaveProperty(
        "confidence_threshold",
      );
      expect(restored.data.turns.at(-1)).not.toHaveProperty(
        "has_confidence_threshold",
      );
    }
  });
  it("derives uncertain from low or missing confidence and persists the decision threshold", async () => {
    const client = new Client();
    const game = await client.request("sessions", "POST", {
      puzzleId: "sample-1",
    });
    try {
      for (const [choice, confidence, decision] of [
        ["yes", 0.1, "uncertain"],
        ["no", 0.4, "uncertain"],
        ["irrelevant", 0.62, "irrelevant"],
        ["uncertain", 0.99, "uncertain"],
        ["uncertain", 0.3, "uncertain"],
        ["yes", undefined, "uncertain"],
      ] as const) {
        mocked.hostChoice = choice;
        mocked.hostConfidence = confidence;
        const response = await client.request(
          `sessions/${game.data.id}/questions`,
          "POST",
          {
            text: "这件事是真的吗？",
            clientRequestId: randomUUID(),
            credentialSource: "byok",
          },
          "canary-host-key",
        );
        expect(response.status).toBe(200);
        expect(response.data.turns.at(-1).decision).toBe(decision);
        expect(response.data.turns.at(-1).confidence.score).toBe(
          confidence ?? null,
        );
        expect(response.data.turns.at(-1).confidence.threshold).toBe(0.45);
        const restored = await client.request(`sessions/${game.data.id}`);
        expect(restored.data.turns.at(-1).confidence.threshold).toBe(0.45);
        expect(restored.data.turns.at(-1).decision).toBe(decision);
      }
    } finally {
      mocked.hostChoice = "yes";
      mocked.hostConfidence = 0.99;
    }
  });
  it("soft deletion disables old resources", async () => {
    expect(
      (await author.request("puzzles/" + puzzleId, "DELETE", {})).status,
    ).toBe(200);
    expect(
      (await author.request("puzzles/" + puzzleId + "/export")).status,
    ).toBe(404);
  });
});

describe("explanation submission", () => {
  async function fresh() {
    const client = new Client();
    const r = await client.request("sessions", "POST", {
      puzzleId: "sample-1",
    });
    return { client, id: r.data.id };
  }
  async function guess(client: Client, id: string) {
    return client.request(
      `sessions/${id}/guess`,
      "POST",
      {
        text: "完整解释",
        clientRequestId: randomUUID(),
        credentialSource: "byok",
      },
      "canary-guess-key",
    );
  }
  it("keeps incomplete and contradictory guesses active without leaking secret facts", async () => {
    const cases: Record<string, string>[] = [
      { f2: "missing" },
      { f2: "contradicted", coherence: "conflicting" },
      { coherence: "insufficient" },
    ];
    for (const choices of cases) {
      const { client, id } = await fresh();
      mocked.guessChoices = choices;
      const r = await guess(client, id);
      expect(r.status).toBe(200);
      expect(r.data.status).toBe("active");
      expect(r.data.turns.at(-1).decision).toBe("incomplete");
      expect(r.data.solution).toBeUndefined();
      expect(JSON.stringify(r.data)).not.toContain(puzzleContent.facts[1].text);
      expect(
        (
          await client.request(
            `sessions/${id}/questions`,
            "POST",
            {
              text: "继续问",
              clientRequestId: randomUUID(),
              credentialSource: "byok",
            },
            "canary-guess-key",
          )
        ).status,
      ).toBe(200);
    }
    mocked.guessChoices = {};
  });
  it("uses only the current explanation, then persists solved and reveals the answer", async () => {
    const { client, id } = await fresh();
    await client.request(
      `sessions/${id}/questions`,
      "POST",
      {
        text: "以前的猜测",
        clientRequestId: randomUUID(),
        credentialSource: "byok",
      },
      "canary-guess-key",
    );
    const r = await guess(client, id);
    expect(r.status).toBe(200);
    expect(mocked.guessHistory).toEqual([]);
    expect(r.data.status).toBe("solved");
    expect(r.data.solution).toBe(puzzleContent.solution);
    const restored = await client.request(`sessions/${id}`);
    expect(restored.data.status).toBe("solved");
    const trace = await client.request(`sessions/${id}/trace`);
    expect(trace.status).toBe(200);
    expect(trace.data.turns.at(-1).trace.request.state.history).toEqual([]);
    expect(
      trace.data.turns.at(-1).trace.response.answers.coherence.choice,
    ).toBe("coherent");
    expect(restored.data.turns.at(-1).confidence.threshold).toBe(0.7);
    const count = mocked.keys.length;
    expect((await guess(client, id)).status).toBe(409);
    expect(mocked.keys.length).toBe(count);
    expect(
      (await client.request(`sessions/${id}/reveal`, "POST", {})).data.status,
    ).toBe("solved");
  });
  it("does not finish a game with low-confidence evidence", async () => {
    const { client, id } = await fresh();
    mocked.guessConfidence = 0.69;
    const r = await guess(client, id);
    expect(r.data.status).toBe("active");
    expect(r.data.solution).toBeUndefined();
    expect(r.data.turns.at(-1).decision).toBe("uncertain");
    expect(r.data.turns.at(-1).confidence.score).toBe(0.69);
    mocked.guessConfidence = 0.99;
  });
  it("shows historical confidence without exposing metadata or accepting malformed scores", async () => {
    const { client, id } = await fresh();
    const response = await guess(client, id);
    const turnId = response.data.turns.at(-1).id;
    // Model metadata already exists on old turns; no backfill or new model call is needed.
    for (const score of [0.89, 0, null, "0.99", 1.1]) {
      const metadata = {
        confidence: {
          f2: 0.91,
          f3: score,
          coherence: 0.95,
          unexpected: "canary-private-provider-data",
        },
        providerDetail: "canary-private-provider-data",
      };
      await query(
        sql`UPDATE turns SET metadata=${JSON.stringify(metadata)}::jsonb WHERE id=${turnId}`,
      );
      const restored = await client.request(`sessions/${id}`);
      const valid = typeof score === "number" && score <= 1 ? score : null;
      expect(restored.data.turns.at(-1).confidence).toEqual({
        score: valid,
        threshold: 0.9,
        checks: [
          { kind: "fact", score: 0.91 },
          { kind: "fact", score: valid },
          { kind: "coherence", score: 0.95 },
        ],
      });
      expect(restored.data.turns.at(-1)).not.toHaveProperty("metadata");
      expect(JSON.stringify(restored.data)).not.toContain(
        "canary-private-provider-data",
      );
    }
    await query(sql`UPDATE turns SET metadata=NULL WHERE id=${turnId}`);
    const restored = await client.request(`sessions/${id}`);
    expect(restored.data.turns.at(-1).confidence.score).toBeNull();
    expect(
      restored.data.turns
        .at(-1)
        .confidence.checks.every((c: { score: unknown }) => c.score === null),
    ).toBe(true);
  });
  it("does not overwrite an explicit reveal with a late grading result", async () => {
    const { client, id } = await fresh();
    mocked.delay = 100;
    const pending = guess(client, id);
    // Wait for the request to be claimed, without relying on wall-clock timing.
    await vi.waitFor(async () => {
      const rows = await query(
        sql`SELECT pending_id FROM sessions WHERE id=${id}`,
      );
      expect(rows[0].pending_id).toBeTruthy();
    });
    await client.request(`sessions/${id}/reveal`, "POST", {});
    const r = await pending;
    expect(r.data.status).toBe("revealed");
    expect(r.data.turns.at(-1).status).toBe("cancelled");
    mocked.delay = 0;
  });
});
