import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { query, sql } from "./db";
import { publicConfidence } from "./confidence";
import { normalizeHostDecision, type PuzzleInput } from "@/shared/puzzle";
export const uid = () => randomUUID();
export const secret = () => randomBytes(32).toString("base64url");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export async function visitor(req: NextRequest, create = false) {
  const token = req.cookies.get("soup_visitor")?.value;
  if (token) {
    const [v] = await query(
      sql`SELECT id FROM visitors WHERE secret_hash=${hash(token)} AND expires_at>now()`,
    );
    if (v) return { id: v.id as string };
  }
  if (!create) return null;
  const tokenNew = secret(),
    id = uid();
  await query(
    sql`INSERT INTO visitors(id,secret_hash,expires_at) VALUES (${id},${hash(tokenNew)},now()+interval '90 days')`,
  );
  return { id, token: tokenNew };
}
export async function puzzle(id: string, visitorId?: string, manage = false) {
  const [p] = await query(
    sql`SELECT p.*,r.public_content,r.secret_content FROM puzzles p JOIN revisions r ON r.id=p.revision WHERE p.id=${id} AND NOT p.disabled`,
  );
  if (!p) throw new AppError("not_found", 404);
  if (visitorId && p.owner_id === visitorId) return p;
  const grants = visitorId
    ? await query(
        sql`SELECT role,version FROM grants WHERE visitor_id=${visitorId} AND puzzle_id=${id}`,
      )
    : [];
  if (grants.some((g) => g.role === "manage" && g.version === p.manage_version))
    return p;
  if (manage) throw new AppError("not_found", 404);
  if (
    p.visibility === "curated" ||
    (p.visibility === "archived" && p.owner_id === null) ||
    (p.visibility === "unlisted" &&
      grants.some((g) => g.role === "play" && g.version === p.share_version))
  )
    return p;
  throw new AppError("not_found", 404);
}
export async function session(id: string, visitorId: string) {
  const [s] = await query(
    sql`SELECT s.*,r.public_content,r.secret_content FROM sessions s JOIN revisions r ON r.id=s.revision_id WHERE s.id=${id} AND s.visitor_id=${visitorId}`,
  );
  if (!s) throw new AppError("not_found", 404);
  await puzzle(s.puzzle_id, visitorId);
  return s;
}
export function publicPuzzle(p: Record<string, any>) {
  return {
    id: p.id,
    revision: p.revision,
    ...p.public_content,
    visibility: p.visibility,
  };
}
export async function game(id: string, visitorId: string) {
  const s = await session(id, visitorId);
  const turns = await query(
    sql`SELECT id,request_id AS "requestId",kind,input,decision,status,metadata->'trace'->'response' AS response,metadata->'confidence' AS confidence,metadata->'confidenceThreshold' AS confidence_threshold,metadata ? 'confidenceThreshold' AS has_confidence_threshold FROM turns WHERE session_id=${id} ORDER BY created_at,id`,
  );
  // An expired lease cannot produce a committed result. Report it without retrying the model.
  for (const turn of turns) {
    if (
      turn.status === "pending" &&
      (s.pending_id !== turn.id ||
        !s.lease_until ||
        new Date(s.lease_until) <= new Date())
    ) {
      turn.status = "failed";
      turn.decision = "result_unknown";
    }
  }
  const requiredIds = (s.secret_content as PuzzleInput).facts
    .filter((fact) => fact.required)
    .map((fact) => fact.id);
  return {
    id: s.id,
    status: s.status,
    puzzle: { id: s.puzzle_id, revision: s.revision_id, ...s.public_content },
    hints: s.secret_content.hints.slice(0, s.hint_count),
    turns: turns.map(
      ({ confidence_threshold, has_confidence_threshold, ...turn }) => ({
        ...turn,
        decision:
          turn.kind === "question" && turn.status === "complete"
            ? normalizeHostDecision(turn.decision)
            : turn.decision,
        confidence:
          turn.status === "complete"
            ? publicConfidence(
                turn.kind,
                turn.confidence,
                requiredIds,
                confidence_threshold,
                has_confidence_threshold === true,
              )
            : null,
      }),
    ),
    ...(s.status !== "active" ? { solution: s.secret_content.solution } : {}),
  };
}
