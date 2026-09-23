# Implementation Grill Plan — 提问判定改为三分类 + 置信度判「无法确认」

> 聚焦：把 R1-R7 落到具体文件与函数，并消除与现有代码/测试的冲突。

## 改动地图（读代码得出）

| 文件 | 现状 | 需要改 |
|---|---|---|
| `src/shared/confidence.ts` | `CONFIDENCE_THRESHOLD = 0.7`；`HOST_LOW_CONFIDENCE_THRESHOLD = 0.7`（仅展示） | 新增 host 判定阈值 0.45；改 0.7 常量的注释 |
| `src/server/host.ts` | criteria 4 个；rules 2/4/5/6 引用 uncertain；history 回传 `{input, decision}` | criteria 3 个；删除指向 uncertain 的句子；history 只回传 `input` |
| `src/server/model.ts` | `hostDecision(answer)` 只看 choice，非法抛 502；host 的 `confidenceThreshold: null` | 判定加入 confidence < 0.45；缺失判 uncertain；元数据写阈值；`judge` 的 history 参数类型 |
| `src/components/app.tsx` | `uncertain: ["暂时无法判断", ...]`；帮助文案写「或「暂时无法判断」」 | 文案改「无法确认」 |
| `src/components/confidence.tsx` | host 分支显示「评分仅供参考，不改变主持人的回答」 | 阈值非 null 时显示判定阈值与解释 |
| `tests/fixtures/host-prompt.json` | 4 个 criteria 的 prompt 快照 | 同步为 3 个 |
| `tests/host.test.ts` | describe 名「four-answer host」；断言 4 个 criteria；断言 `state.history[0].decision` | 改为三分类断言；删除 history.decision 断言 |
| `tests/api.test.ts` | 第 410-424 行 `hostDecision` 单参数契约；第 425-480 行断言 4 个 options；**第 481-521 行断言「低置信度仍保留 choice」且 `threshold` 恒为 null** | 三处均需反转重写 |
| `README.md` / `docs/architecture.md` | 描述四种回答、confidence 仅展示 | 描述三分类 + 置信度判定 |

## 已识别的冲突

- `tests/api.test.ts` 第 481-521 行固化与新需求相反的行为：`["yes", 0.1]`、`["no", 0.4]`、`["yes", undefined]` 都断言 `decision === choice`，测试名即「keeps low-confidence or unscored host choices and persists no-threshold metadata」。
- `hostDecision` 是导出函数且被测试直接调用，签名变更会破坏 `tests/api.test.ts` 第 410-424 行。
- `tests/host.test.ts` 第 24 行断言 `state.history[0].decision === "uncertain"`，R7 生效后该字段不存在。

## 已裁决

- **I1 已裁决**：不补充「用均匀概率表达歧义」的新指令，保守删除所有指向 `uncertain` 的句子，先验证 Jev 的特性（模糊输入 → 概率更均匀）。验证观察点：`metadata.trace.response.answers.answer.probabilities` 与 `metadata.trace.response.confidence.answer`。
- **I2 / R7 已裁决**：`hostState()` 的历史只回传 `input`，不回传 `decision`；不加解释性 prompt。

## 已裁决的剩余项

- **I3 已裁决**：置信度达标但标签非法时保持抛 502（数据损坏 ≠ 不确定，性质不同）。
- **I4 已裁决**：新增 `HOST_UNCERTAIN_THRESHOLD = 0.45`；`HOST_LOW_CONFIDENCE_THRESHOLD = 0.7` 保留并改注释为旧记录展示用。
- **I5 已裁决**：新记录显示「判定阈值：0.45」与「低于该值时主持人回答「无法确认」」；阈值 null 的旧记录保留原文案。
- **I6 已裁决**：选 i —— 「不回传」现状已满足（概率从未进入给 Jev 的 state），`metadata.trace` 日志保留，作为验证「模糊输入 → 概率更均匀」的观察点。
