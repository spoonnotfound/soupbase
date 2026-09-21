"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Game, PublicPuzzle, PuzzleInput } from "@/shared/puzzle";
import { Confidence } from "./confidence";
import { ModelTrace } from "./model-trace";
import { PuzzleSource } from "./puzzle-source";
type Config = {
  mode: string;
  model: string;
  repository: string | null;
};
type Library = {
  puzzles: PublicPuzzle[];
};
type View = "play" | "create" | "about" | "settings";
const blank: PuzzleInput = {
  schema_version: "1.0",
  language: "zh",
  title: "",
  surface: "",
  solution: "",
  facts: [{ id: "f1", text: "", required: true }],
  hints: [],
  unknowns: [],
  character_claims: [],
  difficulty: "medium",
  tags: [],
  source: { kind: "original", author: "Anonymous" },
};
const answers: Record<string, [string, string]> = {
  yes: ["是", "Yes"],
  no: ["不是", "No"],
  irrelevant: ["不重要", "Irrelevant"],
  uncertain: ["暂时无法判断", "Cannot determine yet"],
  solved: ["你还原了这个故事", "You solved the mystery"],
  incomplete: [
    "还没有完整还原，可以继续推理",
    "There is more to the story. Keep going.",
  ],
};
const errors: Record<string, [string, string]> = {
  key_required: [
    "请先在设置中输入你的 API Key。",
    "Enter your API key in settings first.",
  ],
  key_rejected: [
    "Key 被服务商拒绝，请检查凭证。",
    "The provider rejected this key.",
  ],
  provider_rate_limit: [
    "模型服务商暂时限流，请稍后重试。",
    "The model provider is rate-limiting requests. Try later.",
  ],
  upstream_failed: [
    "模型请求未完成，可能已经计费；不会自动重试。",
    "The model request did not finish and may have been billed. We will not retry automatically.",
  ],
  not_found: [
    "内容不存在、链接已撤销，或你没有访问权限。",
    "Not found, access denied, or the link was revoked.",
  ],
  request_pending: [
    "上一条问题仍在处理中，请稍后再试。",
    "A question is still being processed.",
  ],
  revision_conflict: [
    "题目已在其他页面更新，请重新打开后编辑。",
    "This puzzle changed elsewhere. Reopen it before editing.",
  ],
  validation_failed: [
    "请检查表单，确保内容完整。",
    "Please check the required fields.",
  ],
  origin_rejected: [
    "站点地址配置与当前地址不一致。",
    "The configured site origin does not match.",
  ],
  too_large: ["内容过长，请缩短后重试。", "This content is too long."],
  game_finished: [
    "这一局已结束，请开始新一局。",
    "This game has ended. Start a new game.",
  ],
  server_error: [
    "服务暂时不可用，请稍后重试。",
    "The service is temporarily unavailable.",
  ],
  invalid_json: ["JSON 格式不正确。", "Invalid JSON format."],
};
export default function App({ locale }: { locale: "zh" | "en" }) {
  const en = locale === "en",
    t = (zh: string, eng: string) => (en ? eng : zh);
  const [showResponse, setShowResponse] = useState(false);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<View>("play"),
    [cfg, setCfg] = useState<Config>(),
    [puzzles, setPuzzles] = useState<PublicPuzzle[]>([]),
    [selected, setSelected] = useState<PublicPuzzle>(),
    [game, setGame] = useState<Game>(),
    [lib, setLib] = useState<Library>({ puzzles: [] });
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [key, setKey] = useState(""),
    [source, setSource] = useState<"site" | "byok">("byok"),
    [question, setQuestion] = useState(""),
    [guess, setGuess] = useState(false),
    [explanation, setExplanation] = useState(""),
    [confirmReveal, setConfirmReveal] = useState(false),
    [theme, setTheme] = useState("dark");
  const [draft, setDraft] = useState<PuzzleInput>({
      ...blank,
      language: locale,
    }),
    [editing, setEditing] = useState<{
      id: string;
      revision: string;
      visibility: string;
    }>(),
    [manageLink, setManageLink] = useState(""),
    [shareLink, setShareLink] = useState(""),
    [deleteConfirm, setDeleteConfirm] = useState(false);
  const gameScroll = useRef<HTMLDivElement>(null),
    questionInput = useRef<HTMLTextAreaElement>(null),
    initial = useRef(false);
  async function api<T>(
    url: string,
    method = "GET",
    body?: unknown,
    useKey = false,
  ): Promise<T> {
    const response = await fetch("/api/" + url, {
      method,
      cache: "no-store",
      headers: {
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
        ...(useKey && source === "byok"
          ? { Authorization: "Bearer " + key }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.code || "server_error");
    return data;
  }
  function explain(e: unknown) {
    const code = e instanceof Error ? e.message : "server_error";
    setError(
      errors[code]?.[en ? 1 : 0] ||
        t(
          "操作未完成，请检查输入后重试。",
          "Could not complete the action. Check your input and retry.",
        ),
    );
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      explain(e);
    } finally {
      setBusy(false);
    }
  }
  async function refreshLibrary() {
    setLib(await api<Library>("library"));
  }
  function navigate(v: View) {
    if (
      v === "play" &&
      selected &&
      !puzzles.some((p) => p.id === selected.id)
    ) {
      const first = puzzles.find((p) => p.language === locale) || puzzles[0];
      if (first) void openPuzzle(first);
      else {
        setSelected(undefined);
        setGame(undefined);
        updateURL();
      }
    }
    setView(v);
    setError("");
    setNotice("");
    if (v === "create") {
      setCreating(false);
      void run(refreshLibrary);
    }
  }
  function updateURL(p?: string, s?: string) {
    const url = new URL(location.href);
    url.search = "";
    if (p) url.searchParams.set("puzzle", p);
    if (s) url.searchParams.set("session", s);
    url.hash = "";
    history.replaceState(null, "", url);
  }
  async function openPuzzle(p: PublicPuzzle) {
    setSelected(p);
    setGame(undefined);
    setQuestion("");
    setExplanation("");
    setGuess(false);
    setConfirmReveal(false);
    setView("play");
    updateURL(p.id);
  }
  async function openSession(id: string) {
    const g = await api<Game>("sessions/" + id);
    setGame(g);
    setQuestion("");
    setExplanation("");
    setGuess(false);
    setSelected(g.puzzle);
    setView("play");
    setConfirmReveal(false);
    updateURL(g.puzzle.id, id);
  }
  async function editPuzzle(p: PublicPuzzle) {
    const r = await api<{ content: PuzzleInput; revision: string }>(
      "puzzles/" + p.id + "/export",
    );
    setDraft(r.content);
    setEditing({ id: p.id, revision: r.revision, visibility: p.visibility });
    setManageLink("");
    setShareLink("");
    setDeleteConfirm(false);
    setCreating(true);
    setView("create");
  }
  useEffect(() => {
    document.documentElement.lang = locale;
    if (initial.current) return;
    initial.current = true;
    const saved = localStorage.getItem("soup-theme");
    if (saved === "light") {
      setTheme("light");
      document.documentElement.dataset.theme = "light";
    }
    void (async () => {
      try {
        const [c, ps, l] = await Promise.all([
          api<Config>("config"),
          api<PublicPuzzle[]>("puzzles"),
          api<Library>("library"),
        ]);
        setCfg(c);
        setSource(c.mode === "byok_only" ? "byok" : "site");
        setPuzzles(ps);
        setLib(l);
        const url = new URL(location.href);
        const access = url.searchParams.get("access"),
          id = url.searchParams.get("id"),
          token = new URLSearchParams(url.hash.slice(1)).get("key");
        if (token) history.replaceState(null, "", url.pathname + url.search);
        if (access && id && token) {
          await api("access/exchange", "POST", {
            id,
            role: access,
            secret: token,
          });
          const p = await api<PublicPuzzle>("puzzles/" + id);
          if (access === "manage") await editPuzzle(p);
          else await openPuzzle(p);
          await refreshLibrary();
        } else if (url.searchParams.has("session"))
          await openSession(url.searchParams.get("session")!);
        else {
          const id = url.searchParams.get("puzzle");
          const p = id
            ? await api<PublicPuzzle>("puzzles/" + id)
            : ps.find((p) => p.language === locale) || ps[0];
          if (p) setSelected(p);
        }
      } catch (e) {
        explain(e);
      } finally {
        setLoading(false);
      }
    })();
    // Initialize once; keys stay in React memory and are never persisted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const panel = gameScroll.current;
    if (panel)
      panel.scrollTop =
        game && game.status !== "active" ? 0 : panel.scrollHeight;
  }, [game?.turns.length, game?.status, guess]);
  useEffect(() => {
    if (gameScroll.current) gameScroll.current.scrollTop = 0;
  }, [selected?.id]);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("soup-theme", next);
  }
  async function start() {
    if (!selected) return;
    const g = await api<Game>("sessions", "POST", { puzzleId: selected.id });
    setGame(g);
    updateURL(selected.id, g.id);
    return g;
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const submission = (guess ? explanation : question).trim();
    if (!submission) return;
    await run(async () => {
      if (source === "byok" && !key) throw new Error("key_required");
      const g = game || (await start());
      if (!g) return;
      const updated = await api<Game>(
        `sessions/${g.id}/${guess ? "guess" : "questions"}`,
        "POST",
        {
          text: submission,
          clientRequestId: crypto.randomUUID(),
          credentialSource: source,
        },
        true,
      );
      setGame(updated);
      if (!guess) setQuestion("");
      else if (updated.status === "solved") setExplanation("");
    });
    requestAnimationFrame(() =>
      questionInput.current?.focus({ preventScroll: true }),
    );
  }
  const label = (decision: string) =>
    answers[decision]?.[en ? 1 : 0] || decision;
  const difficulty = (d: string) =>
    ({
      easy: t("简单", "Easy"),
      medium: t("中等", "Medium"),
      hard: t("较难", "Hard"),
    })[d] || d;
  function link(role: string, id: string, token: string) {
    return `${location.origin}/${locale}?access=${role}&id=${id}#key=${token}`;
  }
  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice(t("已复制。", "Copied."));
  }
  function cleanDraft() {
    return {
      ...draft,
      hints: draft.hints.filter((x) => x.trim()),
      unknowns: draft.unknowns.filter((x) => x.trim()),
      character_claims: draft.character_claims.filter((x) => x.trim()),
      tags: draft.tags.filter((x) => x.trim()),
    };
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      if (editing) {
        const r = await api<{ revision: string }>(
          "puzzles/" + editing.id,
          "PATCH",
          { content: cleanDraft(), baseRevision: editing.revision },
        );
        setEditing({ ...editing, revision: r.revision });
        setNotice(
          t(
            "已保存新版本，正在进行的游戏不受影响。",
            "Saved a new revision. Existing games keep their original story.",
          ),
        );
      } else {
        const r = await api<{ id: string; manageKey: string }>(
          "puzzles",
          "POST",
          cleanDraft(),
        );
        const p = await api<PublicPuzzle>("puzzles/" + r.id);
        setEditing({ id: r.id, revision: p.revision, visibility: "private" });
        setManageLink(link("manage", r.id, r.manageKey));
        setNotice(
          t(
            "题目已保存。请保管好下方的管理链接。",
            "Saved privately. Keep the management link below.",
          ),
        );
      }
      await refreshLibrary();
    });
  }
  const field = (name: keyof PuzzleInput, value: unknown) =>
    setDraft((p) => ({ ...p, [name]: value }));
  const standalone = !!selected && !puzzles.some((p) => p.id === selected.id);
  return (
    <div className={"app-shell" + (view === "play" ? " playing" : "")}>
      <header>
        <a className="brand" href={`/${locale}`}>
          汤底 <span>soupbase</span>
        </a>
        <nav aria-label={t("主导航", "Main navigation")}>
          {(["play", "create", "about"] as View[]).map((v) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              onClick={() => {
                if (v === "create") {
                  setEditing(undefined);
                  setDraft({ ...blank, language: locale });
                  setManageLink("");
                  setShareLink("");
                }
                navigate(v);
              }}
            >
              {
                {
                  play: standalone
                    ? t("返回题库", "Back to puzzles")
                    : t("题库", "Puzzles"),
                  create: t("创作", "Create"),
                  about: t("关于", "About"),
                  settings: "",
                }[v]
              }
            </button>
          ))}
        </nav>
        <div className="header-right">
          {cfg?.repository && (
            <a
              href={cfg.repository}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("GitHub 源码仓库", "GitHub source repository")}
            >
              GitHub ↗
            </a>
          )}
          <a href={`/${en ? "zh" : "en"}`}>{en ? "中文" : "EN"}</a>
          <button
            onClick={toggleTheme}
            aria-label={t("切换明暗主题", "Toggle theme")}
          >
            {theme === "dark" ? "◐" : "◑"}
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
          >
            {t("设置", "Settings")}
          </button>
        </div>
      </header>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button
            onClick={() => setError("")}
            aria-label={t("关闭错误", "Dismiss error")}
          >
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {view === "play" ? (
        <main className={"workspace" + (standalone ? " standalone-game" : "")}>
          {!standalone && (
            <aside>
              <div className="section-heading">
                {t("题库", "PUZZLES")}{" "}
                <span>
                  {String(
                    puzzles.filter((p) => p.language === locale).length,
                  ).padStart(2, "0")}
                </span>
              </div>
              <div className="puzzle-list">
                {puzzles
                  .filter((p) => p.language === locale)
                  .map((p, i) => (
                    <button
                      key={p.id}
                      className={
                        "puzzle-row " +
                        (selected?.id === p.id ? "selected" : "")
                      }
                      onClick={() => void run(() => openPuzzle(p))}
                    >
                      <span className="eyebrow">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <strong>{p.title}</strong>
                      <span>{difficulty(p.difficulty)}</span>
                    </button>
                  ))}
              </div>
              <div className="aside-note">
                {t("选一道题，开始提问。", "Choose a puzzle to begin.")}
                <br />
                {t(
                  "猜到原因后，试着还原。",
                  "Submit your explanation when ready.",
                )}
              </div>
            </aside>
          )}
          <article className="game">
            {loading ? (
              <p className="muted">
                {t("正在打开题库…", "Opening the library…")}
              </p>
            ) : selected ? (
              <>
                {!!game?.turns.length && game.status === "active" && (
                  <div className="conversation-heading">
                    <span>{selected.title}</span>
                    <button
                      onClick={() => {
                        if (gameScroll.current)
                          gameScroll.current.scrollTop = 0;
                      }}
                    >
                      {t("回看题面 ↑", "Read story ↑")}
                    </button>
                  </div>
                )}
                <div
                  className="game-scroll"
                  ref={gameScroll}
                  tabIndex={0}
                  aria-label={t("题面与对话记录", "Story and conversation")}
                >
                  <div className="story-meta">
                    <span className="muted small">
                      {difficulty(selected.difficulty)}
                    </span>
                  </div>
                  <h1>{selected.title}</h1>
                  {game && game.status !== "active" ? (
                    <section className="solution">
                      <div className="eyebrow">{t("本局结果", "RESULT")}</div>
                      <h2 className="result-title">
                        {game.status === "solved"
                          ? t("还原成功", "Mystery solved")
                          : t("已揭晓答案", "Answer revealed")}
                      </h2>
                      <p className="muted small">
                        {game.status === "solved"
                          ? t(
                              "你猜到了故事的关键。",
                              "You found the key to the story.",
                            )
                          : t(
                              "你选择了直接揭晓，本局已结束。",
                              "You chose to reveal the answer. This game has ended.",
                            )}
                      </p>
                      <div className="eyebrow">{t("汤底", "SOLUTION")}</div>
                      <p>{game.solution}</p>
                      <div className="actions">
                        <button
                          className="outline"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await start();
                              setGuess(false);
                              setQuestion("");
                              setExplanation("");
                            })
                          }
                        >
                          {t("重新开始", "Start again")}
                        </button>
                        {cfg?.repository && (
                          <a
                            className="text-link"
                            target="_blank"
                            rel="noreferrer"
                            href={cfg.repository}
                          >
                            {t(
                              "喜欢这个项目？去 GitHub 点个 Star ↗",
                              "Enjoyed it? Star on GitHub ↗",
                            )}
                          </a>
                        )}
                      </div>
                      <ModelTrace key={game.id} sessionId={game.id} en={en} />
                    </section>
                  ) : null}
                  <details
                    className={
                      "game-review" +
                      (!game || game.status === "active" ? " ongoing" : "")
                    }
                    key={game?.status || "new"}
                    open={!game || game.status === "active"}
                  >
                    <summary>
                      {t(
                        "回看题面、对话与提示",
                        "Review story, conversation and hints",
                      )}
                    </summary>
                    <p className="surface">{selected.surface}</p>
                    <div className="rule">
                      {t(
                        "问可以回答「是 / 不是」的问题，一次只问一件事。",
                        "Ask a yes-or-no question, one at a time.",
                      )}
                    </div>
                    {(!game || game.status === "active") &&
                      !game?.turns.length &&
                      !game?.hints.length && (
                        <div className="empty">
                          {t(
                            "你觉得发生了什么？",
                            "What do you think happened?",
                          )}
                          <br />
                          <span>
                            {t("先问一个问题吧。", "Start with a question.")}
                          </span>
                        </div>
                      )}
                    <div className="transcript" aria-live="polite">
                      {game?.turns.map((turn, i) => (
                        <div className="turn" key={turn.id}>
                          <div className="turn-number">
                            {String(i + 1).padStart(2, "0")}
                          </div>
                          <div>
                            {turn.kind === "guess" && (
                              <div className="attempt-label">
                                {t("我的还原", "MY EXPLANATION")}
                              </div>
                            )}
                            <p>{turn.input}</p>
                            <span className={"answer answer-" + turn.decision}>
                              {turn.status === "complete"
                                ? turn.kind === "guess" &&
                                  turn.decision === "uncertain"
                                  ? t(
                                      "还不能确定。你可以补充解释，或继续提问。",
                                      "Not sure yet. Add more detail or keep asking questions.",
                                    )
                                  : label(turn.decision)
                                : turn.status === "pending"
                                  ? t(
                                      "等待结果；超过 45 秒可重新提问。",
                                      "Awaiting a result. After 45 seconds you may ask again.",
                                    )
                                  : t(
                                      "未完成，不自动重试。",
                                      "Not completed. No automatic retry.",
                                    )}
                            </span>
                            {turn.status === "complete" && turn.confidence && (
                              <Confidence value={turn.confidence} en={en} />
                            )}
                            {showResponse && turn.status === "complete" && (
                              <details className="model-trace">
                                <summary>
                                  {t("模型 Response", "Model response")}
                                </summary>
                                {turn.response ? (
                                  <pre>
                                    {JSON.stringify(turn.response, null, 2)}
                                  </pre>
                                ) : (
                                  <p className="muted small">
                                    {t(
                                      "这条历史记录未保存 Response。",
                                      "No response was recorded for this older turn.",
                                    )}
                                  </p>
                                )}
                              </details>
                            )}
                          </div>
                        </div>
                      ))}
                      {game?.status !== "active" &&
                        game?.hints.map((h, i) => (
                          <div className="hint" key={i}>
                            <span className="eyebrow">
                              {t("提示", "HINT")} {i + 1}
                            </span>
                            <p>{h}</p>
                          </div>
                        ))}
                    </div>
                  </details>
                  <PuzzleSource
                    key={selected.id}
                    source={selected.source}
                    en={en}
                  />
                </div>
                {(!game || game.status === "active") && (
                  <div className="game-dock">
                    {!!game?.hints.length && (
                      <details
                        className="current-hint"
                        key={`${game.id}-${game.hints.length}`}
                        open
                      >
                        <summary>
                          {t("提示", "Hint")} {game.hints.length}/
                          {selected.hintTotal}{" "}
                          <span>
                            {t("点击收起 / 展开", "Collapse / expand")}
                          </span>
                        </summary>
                        <div className="hint-content">
                          <p>{game.hints.at(-1)}</p>
                          {game.hints.length > 1 && (
                            <details>
                              <summary>
                                {t("查看之前的提示", "Previous hints")}
                              </summary>
                              {game.hints.slice(0, -1).map((hint, i) => (
                                <p key={i}>
                                  {i + 1}. {hint}
                                </p>
                              ))}
                            </details>
                          )}
                        </div>
                      </details>
                    )}
                    <form
                      className={"composer" + (guess ? " guess-composer" : "")}
                      onSubmit={submit}
                    >
                      <div className="composer-toolbar">
                        <div
                          className="composer-modes"
                          role="group"
                          aria-label={t("输入模式", "Input mode")}
                        >
                          {[false, true].map((mode) => (
                            <button
                              key={String(mode)}
                              type="button"
                              disabled={busy}
                              aria-pressed={guess === mode}
                              onClick={() => {
                                setGuess(mode);
                                setConfirmReveal(false);
                                requestAnimationFrame(() =>
                                  questionInput.current?.focus({
                                    preventScroll: true,
                                  }),
                                );
                              }}
                            >
                              {mode ? t("还原", "Explain") : t("提问", "Ask")}
                            </button>
                          ))}
                        </div>
                        <div className="composer-actions">
                          <button
                            type="button"
                            disabled={
                              busy ||
                              !selected.hintTotal ||
                              (game?.hints.length || 0) >= selected.hintTotal
                            }
                            onClick={() =>
                              void run(async () => {
                                const g = game || (await start());
                                if (g)
                                  setGame(
                                    await api<Game>(
                                      `sessions/${g.id}/hints`,
                                      "POST",
                                      { clientRequestId: crypto.randomUUID() },
                                    ),
                                  );
                              })
                            }
                          >
                            {t("看提示", "Get hint")} {game?.hints.length || 0}/
                            {selected.hintTotal}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            aria-expanded={confirmReveal}
                            onClick={() => setConfirmReveal(!confirmReveal)}
                          >
                            {t("看答案", "View answer")}
                          </button>
                        </div>
                      </div>
                      {guess && (
                        <p id="guess-help" className="guess-help">
                          {t(
                            "说说发生了什么，解释题面中的疑点即可，不用重复所有细节。",
                            "Explain what happened and why the story unfolded this way, in your own words. You do not need every detail.",
                          )}
                        </p>
                      )}
                      <label className="sr-only" htmlFor="question">
                        {guess
                          ? t("你的完整推理", "Your explanation")
                          : t("你的问题", "YOUR QUESTION")}
                      </label>
                      <textarea
                        id="question"
                        ref={questionInput}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing &&
                            e.keyCode !== 229
                          ) {
                            e.preventDefault();
                            if (
                              !busy &&
                              (guess ? explanation : question).trim()
                            )
                              e.currentTarget.form?.requestSubmit();
                          }
                        }}
                        maxLength={guess ? 3000 : 500}
                        value={guess ? explanation : question}
                        onChange={(e) =>
                          guess
                            ? setExplanation(e.target.value)
                            : setQuestion(e.target.value)
                        }
                        aria-describedby={guess ? "guess-help" : undefined}
                        rows={guess ? 3 : 2}
                        placeholder={
                          guess
                            ? t("我的解释是……", "My explanation is…")
                            : t(
                                "比如：他听到了什么声音吗？",
                                "For example: did he hear something?",
                              )
                        }
                        disabled={busy}
                      />
                      <span className="composer-meta">
                        {t(
                          "Enter 发送 · Shift+Enter 换行",
                          "Enter to send · Shift+Enter for a new line",
                        )}
                      </span>
                      <button
                        className="primary"
                        disabled={
                          busy || !(guess ? explanation : question).trim()
                        }
                      >
                        {busy
                          ? t("判断中…", "Thinking…")
                          : guess
                            ? t("提交还原", "Submit explanation")
                            : t("提问", "Ask")}
                      </button>
                    </form>
                    {confirmReveal && (
                      <div className="confirmation">
                        <p>
                          {t(
                            "直接揭晓会结束这一局，不计为还原成功。确定吗？",
                            "Reveal the answer and end this game without marking it solved?",
                          )}
                        </p>
                        <button
                          className="outline"
                          onClick={() => setConfirmReveal(false)}
                        >
                          {t("再想想", "Keep thinking")}
                        </button>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const g = game || (await start());
                              if (g)
                                setGame(
                                  await api<Game>(
                                    `sessions/${g.id}/reveal`,
                                    "POST",
                                    {},
                                  ),
                                );
                              setConfirmReveal(false);
                            })
                          }
                        >
                          {t("确认看答案", "View answer")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p>{t("暂无题目。", "No puzzles yet.")}</p>
            )}
          </article>
        </main>
      ) : (
        <main className="document">
          {view === "settings" && (
            <>
              <div className="eyebrow">PREFERENCES</div>
              <h1>{t("设置", "Settings")}</h1>
              <section>
                <label className="choice-row">
                  <input
                    type="checkbox"
                    checked={showResponse}
                    onChange={(e) => setShowResponse(e.target.checked)}
                  />
                  {t("显示模型 Response", "Show model response")}
                </label>
                <p className="muted small">
                  {t(
                    "在每条回答下查看选项、概率和置信度。本局结束后可查看完整 Request / Response。",
                    "Inspect choices, probabilities and confidence under each answer. Request / response records become available when the game ends.",
                  )}
                </p>
              </section>
              <section>
                <h2>{t("API Key", "API key")}</h2>
                <div className="choice-row">
                  {cfg?.mode !== "byok_only" && (
                    <label>
                      <input
                        type="radio"
                        name="source"
                        checked={source === "site"}
                        onChange={() => setSource("site")}
                      />
                      {t("使用本站 Key", "Hosted access")}
                    </label>
                  )}
                  {cfg?.mode !== "site_only" && (
                    <label>
                      <input
                        type="radio"
                        name="source"
                        checked={source === "byok"}
                        onChange={() => setSource("byok")}
                      />
                      {t("使用自己的 Key", "Bring your own key")}
                    </label>
                  )}
                </div>
                {source === "byok" ? (
                  <>
                    <label className="field">
                      Vercel AI Gateway API Key
                      <input
                        type="password"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        data-1p-ignore
                        placeholder="vck_…"
                        maxLength={512}
                      />
                    </label>
                    <div className="actions">
                      <button
                        className="outline"
                        onClick={() => {
                          setKey("");
                          setNotice(t("Key 已清除。", "Key cleared."));
                        }}
                      >
                        {t("清除 Key", "Clear key")}
                      </button>
                      <button
                        className="primary"
                        onClick={() => navigate("play")}
                      >
                        {t("返回游戏", "Back to game")}
                      </button>
                    </div>
                    <p className="muted small">
                      {t(
                        "刷新页面后需要重新输入 Key。调用会经过本站服务器，费用计入你的 Vercel AI Gateway 账户。本站代码不会将你的 Key 存入数据库、浏览器存储或日志。",
                        "Reloading the page clears your key. Requests go through this server and are billed to your Vercel AI Gateway account. The app does not save your key in its database, browser storage or logs.",
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="muted">
                      {t(
                        "调用费用由站点作者承担。",
                        "The site owner pays for model calls.",
                      )}
                    </p>
                    <button
                      className="primary"
                      onClick={() => navigate("play")}
                    >
                      {t("返回游戏", "Back to game")}
                    </button>
                  </>
                )}
              </section>
              <section>
                <h2>{t("关于模型", "About the model")}</h2>
                <dl>
                  <dt>{t("调用服务", "API service")}</dt>
                  <dd>Vercel AI Gateway</dd>
                  <dt>{t("模型", "Model")}</dt>
                  <dd>{cfg?.model || "Jev"}</dd>
                </dl>
                <p className="muted small">
                  {t(
                    "判题时会把汤面、汤底和你的问题发给模型服务商。服务商可能保留这些请求。想自己管理 Key 和数据，可以下载源码自行部署。",
                    "The model provider receives the story, solution and your question, and may retain these requests. You can self-host to manage your own key and data.",
                  )}
                </p>
              </section>
            </>
          )}
          {view === "about" && (
            <>
              <div className="eyebrow">ABOUT / SOUPBASE</div>
              <h1>{t("关于汤底", "About Soupbase")}</h1>
              <p>
                {t(
                  "海龟汤是一个猜故事的游戏。你先读到一段看似奇怪的故事，再通过提问找出原因。这里由 Jev 回答你的问题。",
                  "Read a puzzling story, then ask questions to work out what happened. Jev answers your questions.",
                )}
              </p>
              <p className="muted small">
                {t(
                  "Jev 是 TypeSafe AI 的模型，负责回答问题、判断你是否猜对。",
                  "Jev, a model from TypeSafe AI, answers questions and checks your explanation.",
                )}{" "}
                <a
                  className="text-link"
                  href="https://typesafe.ai/blog/introducing-system-one-models-and-jev"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("了解 Jev ↗", "About Jev ↗")}
                </a>
              </p>
              <section>
                <h2>{t("怎么玩", "How to play")}</h2>
                <ol>
                  <li>
                    {t(
                      "读汤面，提出一个可以回答是或不是的问题。",
                      "Read the story and ask one yes-or-no question.",
                    )}
                  </li>
                  <li>
                    {t(
                      "用回答缩小可能性，卡住时逐条查看提示。",
                      "Follow the answers. Reveal a hint when you are stuck.",
                    )}
                  </li>
                  <li>
                    {t(
                      "猜到后切换到「还原」，写下你的解释。也可以直接揭晓答案。",
                      "Switch to explanation mode when you have a solution, or reveal the answer.",
                    )}
                  </li>
                </ol>
              </section>
              <section>
                <h2>{t("关于回答", "About the answers")}</h2>
                <p>
                  {t(
                    "Jev 会回答「是」「不是」「不重要」或「暂时无法判断」。题目没交代清楚，或问题有歧义时，它可能无法判断。",
                    "Jev answers Yes, No, Irrelevant or Cannot determine yet. Missing details or an ambiguous question can make it hard to decide.",
                  )}
                </p>
                {cfg?.repository ? (
                  <a
                    className="text-link"
                    href={cfg.repository}
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub ↗
                  </a>
                ) : (
                  <p className="muted small">
                    {t(
                      "源码随项目提供；公开仓库地址将在发布时配置。",
                      "Source is included with the project. A public repository link will be configured when published.",
                    )}
                  </p>
                )}
              </section>
            </>
          )}
          {view === "create" && !creating && (
            <>
              <h1>{t("创作", "Create")}</h1>
              <p className="muted">
                {t(
                  "管理自己的题目，或留一个新谜题给朋友。",
                  "Manage your puzzles or write a new mystery for friends.",
                )}
              </p>
              <button
                className="primary"
                onClick={() => {
                  setEditing(undefined);
                  setDraft({ ...blank, language: locale });
                  setManageLink("");
                  setShareLink("");
                  setDeleteConfirm(false);
                  setCreating(true);
                }}
              >
                {t("新建题目", "New puzzle")}
              </button>
              {
                <section>
                  <h2>{t("我的作品", "My puzzles")}</h2>
                  {lib.puzzles.length ? (
                    lib.puzzles.map((p) => (
                      <div className="library-row" key={p.id}>
                        <div>
                          <strong>{p.title}</strong>
                          <span className="muted small">
                            {p.visibility === "private"
                              ? t("私有", "Private")
                              : p.visibility === "curated"
                                ? t("题库", "Catalog")
                                : t("链接分享", "Unlisted")}
                          </span>
                        </div>
                        <button
                          className="text-link"
                          disabled={busy}
                          onClick={() => void run(() => editPuzzle(p))}
                        >
                          {t("管理", "Manage")}
                        </button>
                        <button
                          className="text-link"
                          disabled={busy}
                          onClick={() => void run(() => openPuzzle(p))}
                        >
                          {t("试玩", "Play")}
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      {t(
                        "还没有作品，点击「新建题目」开始。",
                        "No puzzles yet. Start with New puzzle.",
                      )}
                    </p>
                  )}
                </section>
              }
            </>
          )}
          {view === "create" && creating && (
            <>
              <button className="text-link" onClick={() => navigate("create")}>
                {t("← 返回作品", "← Back to puzzles")}
              </button>
              <div className="eyebrow">
                {editing ? "MANAGE YOUR STORY" : "WRITE A STORY"}
              </div>
              <h1>
                {editing
                  ? t("管理题目", "Manage puzzle")
                  : t("新建题目", "New puzzle")}
              </h1>
              <p className="muted">
                {t(
                  "写下题面、答案和必须猜到的关键事实。保存后可以生成分享链接，题目不会出现在公共题库里。",
                  "Write the story, solution and key facts players need to guess. Save it to create a sharing link. It will not appear in the public catalog.",
                )}
              </p>
              <form onSubmit={save} className="author-form">
                <label className="field">
                  {t("标题", "Title")}
                  <input
                    required
                    maxLength={80}
                    value={draft.title}
                    onChange={(e) => field("title", e.target.value)}
                  />
                </label>
                <label className="field">
                  {t("汤面 · 玩家先看到的故事", "Story · what players see")}
                  <textarea
                    required
                    rows={4}
                    maxLength={2000}
                    value={draft.surface}
                    onChange={(e) => field("surface", e.target.value)}
                  />
                </label>
                <label className="field">
                  {t("汤底 · 完整解答", "Solution · the full answer")}
                  <textarea
                    required
                    rows={5}
                    maxLength={6000}
                    value={draft.solution}
                    onChange={(e) => field("solution", e.target.value)}
                  />
                </label>
                <div className="field">
                  <span>
                    {t("关键事实 · 每行一条", "Key facts · one per line")}
                  </span>
                  {draft.facts.map((f, i) => (
                    <div className="fact-row" key={f.id}>
                      <input
                        aria-label={t("事实", "Fact") + " " + (i + 1)}
                        required
                        value={f.text}
                        maxLength={500}
                        onChange={(e) =>
                          field(
                            "facts",
                            draft.facts.map((x, j) =>
                              i === j ? { ...x, text: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <label className="small">
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={(e) =>
                            field(
                              "facts",
                              draft.facts.map((x, j) =>
                                i === j
                                  ? { ...x, required: e.target.checked }
                                  : x,
                              ),
                            )
                          }
                        />
                        {t("关键", "Key")}
                      </label>
                      <button
                        type="button"
                        disabled={draft.facts.length === 1}
                        aria-label={
                          t("删除事实", "Remove fact") + " " + (i + 1)
                        }
                        onClick={() =>
                          field(
                            "facts",
                            draft.facts.filter((_, j) => j !== i),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    className="text-link small"
                    type="button"
                    disabled={draft.facts.length >= 8}
                    onClick={() =>
                      field("facts", [
                        ...draft.facts,
                        {
                          id:
                            "f" +
                            (Math.max(
                              ...draft.facts.map((f) => Number(f.id.slice(1))),
                            ) +
                              1),
                          text: "",
                          required: true,
                        },
                      ])
                    }
                  >
                    {t("＋ 添加事实", "＋ Add fact")}
                  </button>
                </div>
                <label className="field">
                  {t(
                    "提示 · 每行一条，最多三条",
                    "Hints · one per line, up to three",
                  )}
                  <textarea
                    rows={3}
                    value={draft.hints.join("\n")}
                    onChange={(e) => field("hints", e.target.value.split("\n"))}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  {busy
                    ? t("保存中…", "Saving…")
                    : editing
                      ? t("保存修改", "Save changes")
                      : t("私有保存", "Save privately")}
                </button>
              </form>
              {editing && (
                <section className="management">
                  <h2>{t("分享与管理", "Sharing and access")}</h2>
                  <p className="muted small">
                    {editing.visibility === "private"
                      ? t(
                          "当前仅自己可见。生成分享链接后，拿到链接的人可以游玩。",
                          "Currently private. Create a sharing link to let anyone with the link play.",
                        )
                      : t(
                          "已开启链接分享，不在公共题库中。链接可被转发，你可以随时撤销。",
                          "Link sharing is on; this puzzle is not in the public catalog. Links can be forwarded and you can revoke access at any time.",
                        )}
                  </p>
                  {manageLink && (
                    <div className="link-box">
                      <strong>
                        {t(
                          "管理链接 · 相当于密码，请保存",
                          "Management link · keep it as a password",
                        )}
                      </strong>
                      <input
                        readOnly
                        aria-label={t("管理链接", "Management link")}
                        value={manageLink}
                      />
                      <button
                        className="outline"
                        onClick={() => void run(() => copy(manageLink))}
                      >
                        {t("复制管理链接", "Copy management link")}
                      </button>
                    </div>
                  )}
                  {shareLink && (
                    <div className="link-box">
                      <strong>
                        {t(
                          "分享链接 · 对方可以游玩和揭底",
                          "Sharing link · allows play and reveal",
                        )}
                      </strong>
                      <input
                        readOnly
                        aria-label={t("分享链接", "Sharing link")}
                        value={shareLink}
                      />
                      <button
                        className="outline"
                        onClick={() => void run(() => copy(shareLink))}
                      >
                        {t("复制分享链接", "Copy sharing link")}
                      </button>
                    </div>
                  )}
                  <div className="actions">
                    <button
                      className="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const p = await api<PublicPuzzle>(
                            "puzzles/" + editing.id,
                          );
                          await openPuzzle(p);
                        })
                      }
                    >
                      {t("试玩", "Playtest")}
                    </button>
                    <button
                      className="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const r = await api<{ shareKey: string }>(
                            "puzzles/" + editing.id + "/share",
                            "POST",
                            {},
                          );
                          setShareLink(link("play", editing.id, r.shareKey));
                          setEditing({ ...editing, visibility: "unlisted" });
                          setNotice(
                            t(
                              "已生成分享链接，旧分享链接立即失效。",
                              "New sharing link created. Previous links are revoked.",
                            ),
                          );
                        })
                      }
                    >
                      {t("生成分享链接", "Create sharing link")}
                    </button>
                    <button
                      className="outline"
                      disabled={busy || editing.visibility === "private"}
                      onClick={() =>
                        void run(async () => {
                          await api(
                            "puzzles/" + editing.id + "/share",
                            "DELETE",
                            {},
                          );
                          setShareLink("");
                          setEditing({ ...editing, visibility: "private" });
                          setNotice(t("分享已撤销。", "Sharing revoked."));
                        })
                      }
                    >
                      {t("撤销分享", "Revoke sharing")}
                    </button>
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const r = await api<{ manageKey: string }>(
                            "puzzles/" + editing.id + "/manage-key",
                            "POST",
                            {},
                          );
                          setManageLink(
                            link("manage", editing.id, r.manageKey),
                          );
                          setNotice(
                            t(
                              "已轮换管理链接，旧链接失效。",
                              "Management link rotated. Old links are invalid.",
                            ),
                          );
                        })
                      }
                    >
                      {t("重新生成管理链接", "Rotate management link")}
                    </button>
                  </div>
                  <p className="muted small">
                    {t(
                      "不自动进入公开题库。管理链接丢失且浏览器凭证被清除后，无法找回。",
                      "Not listed in the public catalog. If both your management link and browser credentials are lost, access cannot be recovered.",
                    )}
                  </p>
                  <button
                    className="danger"
                    onClick={() => setDeleteConfirm(!deleteConfirm)}
                  >
                    {t("删除题目", "Delete puzzle")}
                  </button>
                  {deleteConfirm && (
                    <div className="confirmation">
                      <p>
                        {t(
                          "删除后所有分享和旧游戏将不可访问。确认删除？",
                          "This disables all sharing links and existing games. Delete this puzzle?",
                        )}
                      </p>
                      <button
                        className="outline"
                        onClick={() => setDeleteConfirm(false)}
                      >
                        {t("取消", "Cancel")}
                      </button>
                      <button
                        className="outline danger"
                        onClick={() =>
                          void run(async () => {
                            await api("puzzles/" + editing.id, "DELETE", {});
                            setEditing(undefined);
                            setDeleteConfirm(false);
                            await refreshLibrary();
                            setCreating(false);
                            setView("create");
                          })
                        }
                      >
                        {t("确认删除", "Confirm delete")}
                      </button>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </main>
      )}
      <footer>
        <span>{t("一个故事，一些问题。", "A story, a few questions.")}</span>
        <span>
          <a
            href="https://typesafe.ai/blog/introducing-system-one-models-and-jev"
            target="_blank"
            rel="noopener noreferrer"
          >
            Jev by TypeSafe AI ↗
          </a>{" "}
          × Soupbase
        </span>
      </footer>
    </div>
  );
}
