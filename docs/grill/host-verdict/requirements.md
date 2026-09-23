# Requirements — 提问判定改为三分类 + 置信度判「无法确认」

让 Jev 只回答「是 / 否 / 不重要」三种结果，把「无法确认」从模型输出改为系统基于置信度自行判定的结论。

## Scope
- Includes: 提问判定（host）的输入选项与判定路径；「无法确认」的判定条件、数据承载、UI 呈现、prompt 与测试同步。
- Excludes: **还原判定（guess）的全部改动** —— `coherence` 的 `uncertain` criteria、「无法确认」的判定条件、以及 `CONFIDENCE_THRESHOLD = 0.7` 全部保持现状（保留其「证据不可靠绝不放行」的安全阀语义）。

## Constraints
- 旧数据（`turns.decision` 已存的 `uncertain`）必须继续可读、可显示，不得导致历史会话报错。
- 判定不得因缺少置信度数据而误判为「是」或误放行。
- 置信度数据缺失时的降级行为必须有明确定义，且宁可返回「无法确认」，不可猜测。

## Requirement Items

### R1: Jev 的提问判定只输出三种结果
- Status: Confirmed
- Scenario/Trigger: 玩家提问，`judge()` 走 host 分支构造问题时。
- Behavior: `answer` 问题只提供 `yes` / `no` / `irrelevant` 三个 criteria；prompt 不再把「不确定」当作可选业务分类交给模型。
- Acceptance:
  - [ ] `hostQuestions().answer.criteria` 的键恰为 `yes` / `no` / `irrelevant`
  - [ ] `tests/fixtures/host-prompt.json` 与 `tests/host.test.ts` 同步更新且通过
  - [ ] prompt 中不再存在「uncertain 是一种受支持的分类」类规则
- Terminology: [提问判定](../CONTEXT.md)

### R2: 置信度低于阈值时判定「无法确认」
- Status: Confirmed
- Scenario/Trigger: Jev 对 `answer` 返回后，系统决定该轮结论时。
- Behavior: 当 `confidence < 0.45` 时判定为「无法确认」；否则采用 Jev 给出的三分类标签。
  - 等价换算：三选项下 `confidence < 0.45` ⟺ 最大概率 `max < 0.6333`，即模型未形成明显占优意见。
  - 数据源：`providerMetadata.typesafe.confidence.answer`。
- Acceptance:
  - [ ] 新增阈值常量（不得复用 `HOST_LOW_CONFIDENCE_THRESHOLD = 0.7`，两者语义不同）
  - [ ] `confidence < 0.45` → `uncertain`；`confidence >= 0.45` 且 `choice` 合法 → 采用 `choice`
  - [ ] 有覆盖边界（0.449 / 0.45 / 0.451）的单元测试
- Terminology: [无法确认](../CONTEXT.md), [置信度](../CONTEXT.md)

### R3: 「无法确认」复用 `uncertain` 承载
- Status: Confirmed
- Scenario/Trigger: 「无法确认」需要持久化到 `turns.decision` 并在 UI、历史回填、API 中表达。
- Behavior: 沿用现有枚举值 `uncertain`，仅改变其产生来源——不再来自 Jev 的 `choice`，而由系统按 R2 推导。`decisions` 仍为 4 个值，旧记录零破坏。
- Acceptance:
  - [ ] `decisions` 仍为 `["yes","no","irrelevant","uncertain"]`，`normalizeHostDecision` 行为不变
  - [ ] UI 中 `uncertain` 仍能正常显示，文案更新为「无法确认」
  - [ ] 注释/文档说明 `uncertain` 不再由 Jev 直接输出
- Terminology: [无法确认](../CONTEXT.md)

### R4: 改造范围限定在提问判定
- Status: Confirmed
- Scenario/Trigger: 评估是否同步改造还原判定。
- Behavior: `guess` 一律不改——`coherence` 保留 `uncertain`、`gradeGuess` 保留 `CONFIDENCE_THRESHOLD = 0.7` 且保留其「证据不可靠绝不放行」语义。
- Acceptance:
  - [ ] `src/server/guess.ts` 无任何行为变更
  - [ ] `tests/guess.test.ts` 无需修改即通过
- Terminology: [还原判定](../CONTEXT.md)

### R5: 置信度不可用时的降级行为
- Status: Confirmed
- Scenario/Trigger: `providerMetadata.typesafe.confidence.answer` 缺失、非数值、或超出 0..1。
- Behavior: 一律判定为「无法确认」，不得回退到 Jev 的三分类标签，也不得抛错让该轮失败。
- Acceptance:
  - [ ] `undefined` / `null` / `NaN` / `Infinity` / `-1` / `1.01` / 字符串等输入均得到 `uncertain`
  - [ ] 存在显式的类型与范围校验，不得依赖 `undefined < 0.45 === false` 这类隐式行为
- Terminology: [置信度](../CONTEXT.md)

### R6: 置信度在界面上的呈现
- Status: Confirmed
- Scenario/Trigger: 玩家展开某一轮 turn 的 Confidence 详情时。
- Behavior: 待裁决。现状 `confidence.tsx` 对 host 显示「评分仅供参考，不改变主持人的回答」——R2 生效后该表述将不再成立，必须修正。
- Acceptance:
  - [ ] 新记录的界面不再声称评分不参与判定
  - [ ] 旧记录（无阈值元数据）仍有准确说明
- Terminology: [置信度](../CONTEXT.md)

### R7: 喂给 Jev 的历史只包含玩家输入
- Status: Confirmed
- Scenario/Trigger: `hostState()` 为新一轮提问构造 `history` 时。
- Behavior: 历史每一轮只回传玩家的原始输入（`input`），不回传系统此前的判定结果（`decision`）；概率与置信度数据也不进入给 Jev 的 state。
- Acceptance:
  - [ ] `hostState().history` 的元素不含 `decision` 等判定字段
  - [ ] 概率与置信度仍只写入 `metadata.trace` 作为日志，不作为输入回传
- Terminology: [提问判定](../CONTEXT.md)
