import type { Game } from "@/shared/puzzle";

type Marker = { requestId: string; fingerprint: string };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export class SubmissionError extends Error {
  constructor(
    code: string,
    public game?: Game,
    public canStartNew = false,
  ) {
    super(code);
  }
}

/** Keep request identity across transport failures and page reloads, never credentials or text. */
export class Submissions {
  private markers = new Map<string, Marker>();
  constructor(private storage?: Storage) {}
  private read(sessionId: string): Marker | undefined {
    if (this.markers.has(sessionId)) return this.markers.get(sessionId);
    try {
      const value = JSON.parse(
        this.storage?.getItem(`soup-request:${sessionId}`) || "null",
      );
      if (
        value &&
        /^[0-9a-f-]{36}$/i.test(value.requestId) &&
        /^[0-9a-f]{64}$/.test(value.fingerprint)
      )
        return value;
    } catch {
      /* Storage may be unavailable; the in-memory marker still protects retries. */
    }
  }
  private save(sessionId: string, marker: Marker) {
    this.markers.set(sessionId, marker);
    try {
      this.storage?.setItem(
        `soup-request:${sessionId}`,
        JSON.stringify(marker),
      );
    } catch {}
  }
  forget(sessionId: string) {
    this.markers.delete(sessionId);
    try {
      this.storage?.removeItem(`soup-request:${sessionId}`);
    } catch {}
  }
  private resolve(
    sessionId: string,
    marker: Marker,
    game: Game,
    errorCode?: string,
  ): Game {
    const turn = game.turns.find((t) => t.requestId === marker.requestId);
    if (!turn) throw new SubmissionError("result_unconfirmed", game);
    if (turn.status === "complete") {
      this.forget(sessionId);
      return game;
    }
    if (turn.status === "pending")
      throw new SubmissionError("request_pending", game);
    throw new SubmissionError(errorCode || "request_not_completed", game, true);
  }
  async check(sessionId: string, load: () => Promise<Game>): Promise<Game> {
    const game = await load();
    const marker = this.read(sessionId);
    return marker ? this.resolve(sessionId, marker, game) : game;
  }
  async submit(
    sessionId: string,
    kind: "question" | "guess",
    text: string,
    transport: {
      load: () => Promise<Game>;
      send: (requestId: string) => Promise<Game>;
    },
  ): Promise<Game> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify([kind, text])),
    );
    const fingerprint = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const previous = this.read(sessionId);
    const marker =
      previous?.fingerprint === fingerprint
        ? previous
        : { requestId: crypto.randomUUID(), fingerprint };
    if (marker === previous) {
      // A read must succeed before resubmitting an unconfirmed request.
      const game = await transport.load();
      if (game.turns.some((t) => t.requestId === marker.requestId))
        return this.resolve(sessionId, marker, game);
    }
    this.save(sessionId, marker);
    try {
      return this.resolve(
        sessionId,
        marker,
        await transport.send(marker.requestId),
      );
    } catch (error) {
      if (error instanceof SubmissionError) throw error;
      let game: Game;
      try {
        game = await transport.load();
      } catch {
        throw new SubmissionError("result_unconfirmed");
      }
      if (game.turns.some((t) => t.requestId === marker.requestId))
        return this.resolve(
          sessionId,
          marker,
          game,
          error instanceof Error ? error.message : undefined,
        );
      // Preserve the same marker even when neither the POST nor the recovery GET found a result.
      throw new SubmissionError(
        error instanceof Error && error.message !== "Failed to fetch"
          ? error.message
          : "result_unconfirmed",
        game,
      );
    }
  }
}
