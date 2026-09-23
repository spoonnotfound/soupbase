import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { puzzleSchema, publicContent } from "@/shared/puzzle";
import { query, sql } from "./db";
import {
  AppError,
  visitor,
  puzzle,
  session,
  game,
  uid,
  secret,
  hash,
  publicPuzzle,
} from "./access";
import { config } from "./config";
import { judge, selectKey } from "./model";
async function readBody(req: NextRequest) {
  if (Number(req.headers.get("content-length") || 0) > 65536)
    throw new AppError("too_large", 413);
  const reader = req.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > 65536) {
      await reader.cancel();
      throw new AppError("too_large", 413);
    }
    chunks.push(r.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("invalid_json", 422);
  }
}
const idSchema = z.string().min(1).max(100);
const requestSchema = z.object({
  text: z.string().trim().min(1),
  clientRequestId: z.string().uuid(),
  credentialSource: z.enum(["site", "byok"]),
});
export async function handle(req: NextRequest, paths: string[]) {
  let newToken: string | undefined;
  const requestId = uid();
  const reply = (data: unknown, status = 200) => {
    const res = NextResponse.json(data, {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
    });
    if (newToken)
      res.cookies.set("soup_visitor", newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 90 * 86400,
      });
    return res;
  };
  try {
    const method = req.method,
      mutation = method !== "GET";
    if (mutation) {
      const expected = req.nextUrl.origin;
      const incoming = req.headers.get("origin");
      const localAllowed =
        process.env.NODE_ENV !== "production" &&
        [
          "http://localhost:" + req.nextUrl.port,
          "http://127.0.0.1:" + req.nextUrl.port,
        ].includes(incoming || "");
      if (incoming !== expected && !localAllowed)
        throw new AppError("origin_rejected", 403);
      if (!req.headers.get("content-type")?.startsWith("application/json"))
        throw new AppError("invalid_json", 422);
    }
    const [area, id, action] = paths;
    if (paths.length > 3) throw new AppError("not_found", 404);
    if (area === "config" && !id && method === "GET") return reply(config());
    if (area === "puzzles" && !id && method === "GET") {
      const rows = await query(
        sql`SELECT p.id,p.revision,p.visibility,r.public_content FROM puzzles p JOIN revisions r ON r.id=p.revision WHERE p.visibility='curated' AND NOT p.disabled ORDER BY p.created_at,p.id`,
      );
      return reply(rows.map(publicPuzzle));
    }
    let v = await visitor(req, mutation);
    if (v && "token" in v) newToken = v.token;
    const body = mutation ? await readBody(req) : {};
    if (area === "library" && !id && method === "GET") {
      if (!v) return reply({ puzzles: [] });
      const puzzles = await query(
        sql`SELECT DISTINCT p.id,p.revision,p.visibility,r.public_content FROM puzzles p JOIN revisions r ON r.id=p.revision LEFT JOIN grants g ON g.puzzle_id=p.id AND g.visitor_id=${v.id} AND g.role='manage' AND g.version=p.manage_version WHERE NOT p.disabled AND (p.owner_id=${v.id} OR g.visitor_id IS NOT NULL)`,
      );
      return reply({ puzzles: puzzles.map(publicPuzzle) });
    }
    if (
      area === "access" &&
      id === "exchange" &&
      method === "POST" &&
      !action
    ) {
      if (!v) throw new AppError("not_found", 404);
      const b = z
        .strictObject({
          id: idSchema,
          role: z.enum(["play", "manage"]),
          secret: z.string().min(32).max(128),
        })
        .parse(body);
      const [p] = await query(
        sql`SELECT * FROM puzzles WHERE id=${b.id} AND NOT disabled`,
      );
      if (
        !p ||
        (b.role === "play"
          ? p.visibility !== "unlisted" || p.share_hash !== hash(b.secret)
          : p.manage_hash !== hash(b.secret))
      )
        throw new AppError("not_found", 404);
      const version = b.role === "play" ? p.share_version : p.manage_version;
      await query(
        sql`INSERT INTO grants(visitor_id,puzzle_id,role,version) VALUES (${v.id},${b.id},${b.role},${version}) ON CONFLICT(visitor_id,puzzle_id,role) DO UPDATE SET version=excluded.version`,
      );
      return reply({ id: b.id, role: b.role });
    }
    if (area === "puzzles") {
      if (!id && method === "POST") {
        const p = puzzleSchema.parse(body),
          pid = uid(),
          revision = uid(),
          token = secret();
        await query(
          sql`WITH created AS (INSERT INTO puzzles(id,owner_id,manage_hash,revision) VALUES (${pid},${v!.id},${hash(token)},${revision}) RETURNING id) INSERT INTO revisions(id,puzzle_id,public_content,secret_content) SELECT ${revision},id,${JSON.stringify(publicContent(p))}::jsonb,${JSON.stringify(p)}::jsonb FROM created`,
        );
        return reply({ id: pid, manageKey: token }, 201);
      }
      if (!id) throw new AppError("not_found", 404);
      idSchema.parse(id);
      const manage = mutation || action === "export";
      const p = await puzzle(id, v?.id, manage);
      if (method === "GET" && !action) return reply(publicPuzzle(p));
      if (method === "GET" && action === "export") {
        // Older database revisions can still contain the removed question fixtures.
        const { golden_questions: _legacyQuestions, ...content } =
          p.secret_content;
        return reply({
          content: puzzleSchema.parse(content),
          revision: p.revision,
        });
      }
      if (!v) throw new AppError("not_found", 404);
      if (method === "PATCH" && !action) {
        const b = z
          .strictObject({ content: puzzleSchema, baseRevision: idSchema })
          .parse(body);
        const revision = uid();
        const rows = await query(
          sql`WITH updated AS (UPDATE puzzles SET revision=${revision} WHERE id=${id} AND revision=${b.baseRevision} RETURNING id) INSERT INTO revisions(id,puzzle_id,public_content,secret_content) SELECT ${revision},id,${JSON.stringify(publicContent(b.content))}::jsonb,${JSON.stringify(b.content)}::jsonb FROM updated RETURNING id`,
        );
        if (!rows.length) throw new AppError("revision_conflict", 409);
        return reply({ id, revision });
      }
      if (method === "DELETE" && !action) {
        await query(
          sql`UPDATE puzzles SET disabled=true,share_hash=NULL,manage_hash=NULL,share_version=share_version+1,manage_version=manage_version+1 WHERE id=${id}`,
        );
        return reply({ ok: true });
      }
      if (action === "share" && method === "POST") {
        const token = secret();
        await query(
          sql`UPDATE puzzles SET visibility='unlisted',share_hash=${hash(token)},share_version=share_version+1 WHERE id=${id}`,
        );
        return reply({ shareKey: token });
      }
      if (action === "share" && method === "DELETE") {
        await query(
          sql`UPDATE puzzles SET visibility='private',share_hash=NULL,share_version=share_version+1 WHERE id=${id}`,
        );
        return reply({ ok: true });
      }
      if (action === "manage-key" && method === "POST") {
        const token = secret();
        const [r] = await query(
          sql`UPDATE puzzles SET manage_hash=${hash(token)},manage_version=manage_version+1 WHERE id=${id} RETURNING manage_version`,
        );
        await query(
          sql`INSERT INTO grants(visitor_id,puzzle_id,role,version) VALUES (${v.id},${id},'manage',${r.manage_version}) ON CONFLICT(visitor_id,puzzle_id,role) DO UPDATE SET version=excluded.version`,
        );
        return reply({ manageKey: token });
      }
    }
    if (area === "sessions") {
      if (!v) throw new AppError("not_found", 404);
      if (!id && method === "POST") {
        const b = z.strictObject({ puzzleId: idSchema }).parse(body);
        const p = await puzzle(b.puzzleId, v.id),
          sid = uid();
        await query(
          sql`INSERT INTO sessions(id,visitor_id,puzzle_id,revision_id) VALUES (${sid},${v.id},${p.id},${p.revision})`,
        );
        return reply(await game(sid, v.id), 201);
      }
      if (!id) throw new AppError("not_found", 404);
      const s = await session(id, v.id);
      if (!action && method === "GET") return reply(await game(id, v.id));
      if (action === "trace" && method === "GET") {
        if (s.status === "active") throw new AppError("game_active", 409);
        const turns = await query(
          sql`SELECT id,kind,input,status,decision,metadata->'model' AS model,metadata->'trace' AS trace FROM turns WHERE session_id=${id} ORDER BY created_at,id`,
        );
        return reply({ turns });
      }
      if (action === "reveal" && method === "POST") {
        await query(
          sql`UPDATE sessions SET status=CASE WHEN status='solved' THEN 'solved' ELSE 'revealed' END,pending_id=NULL,lease_until=NULL,updated_at=now() WHERE id=${id}`,
        );
        await query(
          sql`UPDATE turns SET status='cancelled' WHERE session_id=${id} AND status='pending'`,
        );
        return reply(await game(id, v.id));
      }
      if (s.status !== "active") throw new AppError("game_finished", 409);
      if (action === "hints" && method === "POST") {
        const b = z
          .strictObject({ clientRequestId: z.string().uuid() })
          .parse(body);
        await query(
          sql`WITH added AS (INSERT INTO hint_requests(session_id,request_id) VALUES (${id},${b.clientRequestId}) ON CONFLICT DO NOTHING RETURNING session_id) UPDATE sessions SET hint_count=LEAST(hint_count+1,${s.secret_content.hints.length}),updated_at=now() WHERE id=${id} AND status='active' AND EXISTS(SELECT 1 FROM added)`,
        );
        return reply(await game(id, v.id));
      }
      if ((action === "questions" || action === "guess") && method === "POST") {
        const b = requestSchema.parse(body);
        if ([...b.text].length > (action === "guess" ? 3000 : 500))
          throw new AppError("too_large", 413);
        const key = selectKey(
          b.credentialSource,
          req.headers.get("authorization")?.replace(/^Bearer /, "") || null,
        );
        const [old] = await query(
          sql`SELECT * FROM turns WHERE session_id=${id} AND request_id=${b.clientRequestId}`,
        );
        if (old) {
          if (old.input !== b.text) throw new AppError("request_conflict", 409);
          if (
            old.status === "pending" &&
            s.lease_until &&
            new Date(s.lease_until) > new Date()
          )
            throw new AppError("request_pending", 409);
          return reply(await game(id, v.id));
        }
        const tid = uid();
        const claimed = await query(
          sql`UPDATE sessions SET pending_id=${tid},lease_until=now()+interval '45 seconds' WHERE id=${id} AND status='active' AND (pending_id IS NULL OR lease_until<now()) RETURNING id`,
        );
        if (!claimed.length) throw new AppError("request_pending", 409);
        await query(
          sql`UPDATE turns SET status='failed',decision='result_unknown' WHERE session_id=${id} AND status='pending'`,
        );
        await query(
          sql`INSERT INTO turns(id,session_id,request_id,kind,input) VALUES (${tid},${id},${b.clientRequestId},${action === "guess" ? "guess" : "question"},${b.text})`,
        );
        try {
          const history = await query<{ input: string }>(
            sql`SELECT input FROM turns WHERE session_id=${id} AND status='complete' ORDER BY created_at DESC LIMIT 6`,
          );
          const result = await judge(
            s.secret_content,
            b.text,
            history.reverse(),
            action === "guess" ? "guess" : "question",
            key,
          );
          await session(id, v.id);
          const finalized = await query(
            sql`WITH finished AS (UPDATE sessions SET pending_id=NULL,lease_until=NULL,status=${result.decision === "solved" ? "solved" : "active"},updated_at=now() WHERE id=${id} AND status='active' AND pending_id=${tid} AND lease_until>now() RETURNING id) UPDATE turns SET status='complete',decision=${result.decision},metadata=${JSON.stringify({ ...result.metadata, credentialSource: b.credentialSource })}::jsonb WHERE id=${tid} AND EXISTS(SELECT 1 FROM finished) RETURNING id`,
          );
          if (!finalized.length)
            await query(
              sql`UPDATE turns SET status='cancelled' WHERE id=${tid}`,
            );
          return reply(await game(id, v.id));
        } catch (e) {
          await query(
            sql`UPDATE turns SET status='failed',decision='result_unknown' WHERE id=${tid} AND status='pending'`,
          );
          await query(
            sql`UPDATE sessions SET pending_id=NULL,lease_until=NULL WHERE id=${id} AND pending_id=${tid}`,
          );
          throw e;
        }
      }
    }
    throw new AppError("not_found", 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return reply(
        {
          code: "validation_failed",
          fields: e.issues.map((i) => i.path.join(".")),
          requestId,
        },
        422,
      );
    if (e instanceof AppError)
      return reply({ code: e.code, requestId }, e.status);
    return reply({ code: "server_error", requestId }, 500);
  }
}
