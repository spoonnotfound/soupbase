# 模型与数据流程 / Architecture

## 请求流程

浏览器 → Next.js API → 服务端读取题目版本和汤底 → 选定服务 → Jev → 服务端校验固定结构 → 保存结果并返回公开字段。

浏览器提交问题、请求 ID、凭证来源和 BYOK 服务。BYOK 通过 Authorization header 传入；凭证仅用于当前请求。站点服务由服务端 `AI_SITE_PROVIDER` 决定，客户端不能替换站点 Key 的目的地。模型会收到汤面、汤底、关键事实及必要上下文，未揭示的汤底不由正常游戏接口返回给玩家。

`src/server/providers.ts` 统一三种调用方式的结果：

| 服务 | 接口 | 模型 |
| --- | --- | --- |
| Vercel AI Gateway | AI SDK `experimental_evaluate` | `typesafe-ai/jev` |
| TypeSafe AI | `POST https://api.typesafe.ai/v1/systemone` | `jev-1.13.0` |
| OpenRouter | `POST https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` |

TypeSafe 和 OpenRouter 使用原生决策接口，不使用 Chat Completions。逐项 `answers[id].confidence` 统一为判题所需结构，`input_tokens` / `output_tokens` 统一为 token 用量。Vercel 的 confidence 来自 SDK 的 `providerMetadata.typesafe.confidence`。三个入口均关闭应用层自动重试，OpenRouter 另设置 `provider.allow_fallbacks=false`，不在不同服务或 Key 之间自动回退。

接口依据：[TypeSafe API](https://docs.typesafe.ai/api)、[TypeSafe 模型](https://docs.typesafe.ai/models)、[OpenRouter Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)。

## 重复提交与响应恢复

每次新提问/还原先生成请求 ID，在当前标签页的 `sessionStorage` 保留该 ID 和内容摘要，不保存输入原文或 Key。响应丢失、刷新后再次提交同一内容时，先读取原结果；服务器还没有记录时才用原 ID 提交。读取失败不会触发模型调用。

数据库的 `(session_id, request_id)` 唯一约束及会话租约阻止并发重复调用。同一 ID 即使原请求失败、会话已结束或 Key 已停用，也只读取已有记录，不再次调用模型；更改请求内容或类型会被拒绝。页面上的「查询结果」只读数据库。失败或处理超时的请求需要明确选择「重新发起（可能再次计费）」才用新 ID 重做。

这避免了应用自动重试造成的额外调用，但不能撤回供应商已处理的请求，也不能确定网络中断时供应商是否计费。主动新建请求、改写问题或重新开局仍是新的调用。

## 主持人

`src/server/host.ts` 定义提问提示词，使用 Choice：yes / no / irrelevant。

- 已知或可可靠推导的事实先回答是/不是，包括无关细节。
- 未知、无关细节回答不重要。
- 「无法确认」不由模型输出：当 confidence < 0.45（约等于最大概率 < 0.633）时判定为无法确认；置信度缺失或非法时同样判定为无法确认，绝不回退到模型的标签。
- 喂给模型的 history 只包含玩家输入，不回传此前的判定结果。
- 旧记录没有阈值元数据，仍按展示阈值 0.70 标注把握较低。

## 还原判断

`src/server/guess.ts` 定义还原提示词。每个必需关键点使用 Choice 判断成立/缺失/矛盾，另检查整体解释。结合公开汤面理解简短还原，不要求重复已知事实，也不从汤底替玩家补上缺失的核心机制。

全部关键点 supported、整体 coherent，且每项原生 confidence ≥ 0.70 才通关。缺失、非法或低置信度结果不会解锁答案。旧记录保留当时门槛；缺少门槛的旧还原记录回退到历史值 0.90。

confidence 是概率分布的统计量，不是正确率，也不是通关进度。提示和主动揭晓直接读取已保存内容，不调用模型。

## 数据与访问

- `src/shared/puzzle.ts`：题目格式和公开字段。
- `src/server/schema.sql`：数据库结构。
- `src/server/access.ts`：访客、分享、管理和会话权限。
- `src/server/api.ts`：请求处理、幂等、并发控制和持久化。
- `scripts/catalog.ts` / `sync-content.ts`：校验并同步 Git 题库。

内容修改创建新版本，已有游戏固定在原版本。私有创作不会进入 curated 公共列表；分享和管理凭证相互独立，可撤销。部署者管理自己的数据库及备份。

## Validation

Automated tests check application contracts and permissions with a mock model. The host prompt fixture prevents accidental drift. Neither proves model accuracy. Changes to prompts should be checked on labeled Chinese/English cases, including concise valid explanations, missing mechanisms, contradictions and prompt injection. Keep private inputs, raw provider logs and credentials out of public test data.
