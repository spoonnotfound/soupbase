# Requirements Grill Plan — 提问判定改为三分类 + 置信度判「无法确认」

> 本次盘问聚焦：Jev 只输出 是/否/不重要 三种结果，由系统在置信度偏低时自行判定「无法确认」。

## 已确认基线（读取代码得到）

- 判定入口：`src/server/model.ts` 的 `judge()`；提问走 `hostDecision(answers?.answer)`（第 24-29 行），还原走 `gradeGuess()`（`src/server/guess.ts`）。
- 当前 host criteria 为 4 个（`src/server/host.ts` 第 11-18 行）；结果枚举 `decisions` 为 4 个值（`src/shared/puzzle.ts` 第 9 行）。
- **当前 host 判定完全不使用 `probabilities`/`confidence`**：`hostDecision()` 只看 `answers.answer.choice`，非法即抛 `upstream_failed` 502。
- `hostState()` 回填历史用 `normalizeHostDecision()`，非法值归一到 `uncertain`（`puzzle.ts` 第 12-16 行）。
- Jev 三选项下 `confidence = (最大概率 × 3 − 1) / 2`，故 `max = (2c + 1) / 3`。
- 现有常量 `CONFIDENCE_THRESHOLD = 0.7`（用于 guess 的 fact 判定）与 `HOST_LOW_CONFIDENCE_THRESHOLD = 0.7`（注释为「Display only: never changes a host decision」）。

## 已裁决

- **Q1 已裁决**：「无法确认」复用现有枚举值 `uncertain`，`decisions` 仍为 4 个值；Jev 的 criteria 由 4 个收窄为 3 个。术语见根 `CONTEXT.md`。
- **Q2 已裁决**：判据为 `confidence < 0.45` → `uncertain`（等价 `max < 0.6333`）。数据源为 `providerMetadata.typesafe.confidence.answer`。

## Unresolved Questions

### Q3: 置信度数据不可用时的降级行为 {In Progress}
- `confidence` 被 AI SDK 标注为 provider-specific 且 optional，可能整块缺失；也可能为非数值或越界。
- 待定：缺失/非法时判「无法确认」、回退 `choice`，还是抛 502。

### Q4: `choice` 与置信度的关系 {Pending}
- `confidence >= 0.45` 但 `choice` 非法/缺失时：是否仍抛 502？
- `choice` 是否降级为纯日志字段（继续写入 `metadata.trace`）。

### Q5: 改造范围是否包含还原判定 {Pending}
- `GuessDecision` 的 `uncertain`、`coherence` 的 `uncertain` criteria、`CONFIDENCE_THRESHOLD = 0.7` 是否同步改造。

### Q6: 旧数据与历史回填 {Pending}
- 已存的 `uncertain` 记录、以及喂回 Jev 的 `history[].decision` 在新 criteria 下如何自洽。

### Q7: prompt / criteria / fixture 同步 {Pending}
- `tests/fixtures/host-prompt.json` 与 `tests/host.test.ts` 的「four-answer host」断言改写方式。

### Q8: 阈值常量命名与放置 {Pending}
- 新常量（0.45）落在 `src/shared/confidence.ts`；与 `HOST_LOW_CONFIDENCE_THRESHOLD = 0.7` 的关系（并存 / 取代 / 改名）。

### Q9: UI 文案 {Pending}
- `uncertain` 文案由「暂时无法判断」改为「无法确认」；`app.tsx` 中 guess+uncertain 的特例文案如何处理。
