import { describe, expect, it, vi } from "vitest";
import { Submissions, SubmissionError } from "../src/client/submissions";
import type { Game } from "../src/shared/puzzle";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function game(requestId?: string, status = "complete"): Game {
  return {
    id: "game-1",
    status: "active",
    puzzle: {} as Game["puzzle"],
    hints: [],
    turns: requestId
      ? [
          {
            id: "turn-1",
            requestId,
            kind: "question",
            input: "私有问题",
            decision: "yes",
            status,
            confidence: null,
          },
        ]
      : [],
  };
}

describe("safe game submissions", () => {
  it("recovers a committed answer when the POST response is lost", async () => {
    const submissions = new Submissions(memoryStorage());
    let saved = game();
    const send = vi.fn(async (id: string) => {
      saved = game(id);
      throw new TypeError("Failed to fetch");
    });
    expect(
      await submissions.submit("game-1", "question", "私有问题", {
        send,
        load: async () => saved,
      }),
    ).toEqual(saved);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("recovers after a reload without persisting text or credentials or making another POST", async () => {
    const storage = memoryStorage();
    let saved = game();
    const send = vi.fn(async (id: string) => {
      saved = game(id);
      throw new TypeError("Failed to fetch");
    });
    await expect(
      new Submissions(storage).submit("game-1", "question", "私有问题", {
        send,
        load: async () => {
          throw new TypeError("offline");
        },
      }),
    ).rejects.toThrow("result_unconfirmed");
    const marker = JSON.parse([...storage.values.values()][0]);
    expect(Object.keys(marker).sort()).toEqual(["fingerprint", "requestId"]);
    expect(JSON.stringify(marker)).not.toContain("私有问题");
    const replay = vi.fn();
    expect(
      await new Submissions(storage).submit("game-1", "question", "私有问题", {
        send: replay,
        load: async () => saved,
      }),
    ).toEqual(saved);
    expect(replay).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
  });

  it("reuses the same ID when the first POST never reached the server", async () => {
    const submissions = new Submissions(memoryStorage());
    const send = vi.fn(async (id: string) => {
      if (send.mock.calls.length === 1) throw new TypeError("Failed to fetch");
      return game(id);
    });
    const transport = { send, load: vi.fn(async () => game()) };
    await expect(
      submissions.submit("game-1", "question", "私有问题", transport),
    ).rejects.toThrow();
    await submissions.submit("game-1", "question", "私有问题", transport);
    expect(send.mock.calls[0][0]).toBe(send.mock.calls[1][0]);
    expect(transport.load).toHaveBeenCalledTimes(2);
  });

  it("never resends pending or failed work until a new request is explicitly chosen", async () => {
    const submissions = new Submissions(memoryStorage());
    let saved = game();
    const send = vi.fn(async (id: string) => {
      saved = game(id, "pending");
      return saved;
    });
    const transport = { send, load: async () => saved };
    await expect(
      submissions.submit("game-1", "question", "私有问题", transport),
    ).rejects.toMatchObject({ message: "request_pending", canStartNew: false });
    await expect(
      submissions.submit("game-1", "question", "私有问题", transport),
    ).rejects.toThrow("request_pending");
    saved = game(saved.turns[0].requestId, "failed");
    await expect(
      submissions.submit("game-1", "question", "私有问题", transport),
    ).rejects.toMatchObject({
      message: "request_not_completed",
      canStartNew: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
    submissions.forget("game-1");
    await expect(
      submissions.submit("game-1", "question", "私有问题", transport),
    ).rejects.toBeInstanceOf(SubmissionError);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).not.toBe(send.mock.calls[1][0]);
  });

  it("does not POST when the recovery read is unavailable", async () => {
    const submissions = new Submissions();
    const send = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const transport = {
      send,
      load: async () => {
        throw new TypeError("offline");
      },
    };
    await expect(
      submissions.submit("game-1", "question", "私有问题", transport),
    ).rejects.toThrow();
    await expect(
      submissions.submit("game-1", "question", "私有问题", transport),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
