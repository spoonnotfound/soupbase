# Implementation — 提问判定改为三分类 + 置信度判「无法确认」

实现已完成（S1-S5、S7 已落地；S6 的代码改动已完成但未在本地运行验证——依赖未安装）。

## Scope
- Target: `src/shared/confidence.ts`、`src/server/host.ts`、`src/server/model.ts`、`src/server/api.ts`、`src/components/app.tsx`、`src/components/confidence.tsx`、`tests/host.test.ts`、`tests/api.test.ts`、`tests/fixtures/host-prompt.json`、`README.md`、`README.en.md`、`docs/architecture.md`
- Excludes: `src/server/guess.ts`（R4 明确不改）、`src/shared/puzzle.ts`（`decisions` 与 `normalizeHostDecision` 保持）、无数据库迁移

## Implementation Steps

### S1: 新增 host 判定阈值常量
- Status: Done
- Target: `src/shared/confidence.ts`
- Approach: 新增 `HOST_UNCERTAIN_THRESHOLD = 0.45`；`HOST_LOW_CONFIDENCE_THRESHOLD = 0.7` 的注释改为「Display only, and only for host turns saved before decisions became confidence-driven」；`CONFIDENCE_THRESHOLD = 0.7` 保持不动。
- Acceptance:
  - [x] 存在值为 0.45 的 host 判定阈值常量
  - [x] `CONFIDENCE_THRESHOLD = 0.7` 未被改动
- Rationale: 0.45 与 0.7 语义不同（真实判定 vs 旧记录展示），复用会让旧记录被重新定性
- Terminology: [置信度](../../../CONTEXT.md)

### S2: 收窄并删减提问 prompt
- Status: Done
- Target: `src/server/host.ts` 的 `hostQuestions()`
- Approach: `criteria` 删除 `uncertain`；删除规则 2 的「choose uncertain」句、规则 4 的「choose uncertain; do not arbitrarily pick a source.」句、规则 5 的 uncertain 分支、规则 6 整条。其余原文一字不动。
- Acceptance:
  - [x] `criteria` 键恰为 `yes` / `no` / `irrelevant`
  - [x] prompt 中不再出现把「不确定」当作可选分类的表述
- Rationale: Jev 只应在三分类中选择；先不补充新规则，以便观察模型自身的概率分布行为
- Terminology: [提问判定](../../../CONTEXT.md)

### S3: 判定路径改为置信度驱动
- Status: Done
- Target: `src/server/model.ts` 的 `hostDecision()` 与 `judge()`
- Approach: `hostDecision(answer, confidence)`；置信度非有限数值或超出 0..1 → `uncertain`；`< 0.45` → `uncertain`；否则校验 `choice` 属于合法判定值，非法抛 `upstream_failed`；host 的 `metadata.confidenceThreshold` 写 `0.45`。
- Acceptance:
  - [x] `undefined` / `null` / `NaN` / `Infinity` / `-1` / `1.01` / 字符串 → `uncertain`
  - [x] `0.449` → `uncertain`，`0.45` / `0.451` → 采用 `choice`
  - [x] host 的 `confidenceThreshold` 写入 0.45
- Rationale: 置信度是唯一能表达「模型没有形成明显占优意见」的信号
- Terminology: [无法确认](../../../CONTEXT.md)

### S4: 界面文案
- Status: Done
- Target: `src/components/app.tsx`、`src/components/confidence.tsx`
- Approach: `uncertain` 文案改「无法确认 / Cannot determine」；帮助文案改为描述三分类与「无法确认」来源；`confidence.tsx` 中 host 记录在阈值非 null 时追加「低于该值时主持人回答「无法确认」」，阈值 null 的旧记录保留原文案。
- Acceptance:
  - [x] 新记录界面不再声称评分不参与 host 判定
  - [x] 旧记录（无阈值元数据）仍有准确说明
- Terminology: [无法确认](../../../CONTEXT.md)

### S5: 历史只回传玩家输入
- Status: Done
- Target: `src/server/host.ts` 的 `hostState()`、`src/server/model.ts` 的 `judge()`、`src/server/api.ts`
- Approach: `history` 类型收窄为 `{ input: string }[]`，映射只保留 `input`；`api.ts` 的历史查询同步收窄为 `SELECT input`。
- Acceptance:
  - [x] `hostState().history` 元素只有 `input`
  - [x] `tests/host.test.ts` 中 `state.history[0].decision` 的断言已删除
- Rationale: 避免历史判定锚定当前判定，并消除历史值引发的非法标签风险
- Terminology: [提问判定](../../../CONTEXT.md)

### S6: 测试与快照同步
- Status: Done（`tests/api.test.ts` 受本机环境阻塞，见「验证记录」）
- Target: `tests/host.test.ts`、`tests/fixtures/host-prompt.json`、`tests/api.test.ts`
- Approach: 更新 prompt 快照（3 个 criteria）；`describe` 名与 criteria 断言改为三分类；历史断言改为只含 `input`；`hostDecision` 调用改为双参数并新增置信度边界与降级用例；反转原「低置信度仍保留 choice」用例为「低置信度/缺失置信度判 `uncertain`」并断言阈值 0.45；options 断言 4 → 3。
- Acceptance:
  - [x] `tests/host.test.ts`、`tests/guess.test.ts`、`tests/catalog.test.ts`、`tests/deployment.test.ts` 通过
  - [x] 已写入并在本机实测覆盖 0.449 / 0.45 / 0.451 边界的用例
  - [ ] `tests/api.test.ts` 待能在可运行 PGlite 文件后端的环境执行
- Rationale: 该文件固化的是即将被推翻的旧契约
- Terminology: [置信度](../../../CONTEXT.md)

### S7: 文档同步
- Status: Done
- Target: `README.md`、`README.en.md`、`docs/architecture.md`
- Approach: 「四种主持回答」「confidence 仅展示」「暂时无法判断」的表述全部更新为三分类 + 置信度判定。
- Acceptance:
  - [x] 文档不再声称 confidence 不参与 host 判定
- Terminology: [置信度](../../../CONTEXT.md)

## 验证记录

- `npm ci` 安装依赖后执行 `npm test`：**4 个测试文件通过（`host`、`guess`、`catalog`、`deployment`），`api.test.ts` 全部失败**。
- `api.test.ts` 的失败为**本机环境问题，与本次改动无关**，证据链：
  1. 20/20 用例失败，包含与判定毫无关系的用例（如 `blocks cross-origin mutation and oversized bodies`）；
  2. 失败点在共用初始化 `CREATE TABLE visitors`，抛 `ErrnoError { errno: 28 }`（ENOSPC）；
  3. 用 `node` 直接实例化 PGlite：文件后端 `new PGlite(dir)` 复现 `errno: 28`，内存后端 `new PGlite()` 返回 `PGLITE_OK`；
  4. 失败路径位于 `src/server/db.ts` 的迁移逻辑，本次改动未触碰数据库层。
- 替代验证：用 `tsx` 直接调用 `hostDecision`，结果与 R2/R5 完全一致——`0.99→yes`、`0.44→uncertain`、`0.45→yes`、`0.451→yes`、`undefined/null/NaN/Infinity/-1/1.01/"0.99"→uncertain`、置信度正常但标签非法→抛 `upstream_failed`。
- 磁盘并未真正耗尽（D 盘剩余 52GB），属于 PGlite 的 Emscripten NODEFS 后端在 Windows 下的兼容问题；在 CI/Linux 上应可正常执行。
- IDE 诊断（`read_lints`）报告 0 个错误。
