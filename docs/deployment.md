# 部署

## Vercel + Neon PostgreSQL

可以在 Vercel 内直接创建 PostgreSQL。当前入口是 Marketplace 的 Neon 集成；旧 Vercel Postgres 产品已迁移到 Neon，不需要使用旧的 `@vercel/postgres` SDK。本项目使用标准 PostgreSQL 连接。

### 一键部署

1. 点击 README 的部署按钮。部署流程会引导连接 Neon 集成、创建数据库，并自动注入 `DATABASE_URL`。选择套餐时确认其费用。
2. 选择凭证模式 `AI_ACCESS_MODE`：`byok_only`、`site_only` 或 `both`。
3. 站点 Key + BYOK 按钮默认 `both`，要求你填自己的 `AI_GATEWAY_API_KEY`；仅 BYOK 按钮默认 `byok_only`，无需站点 Key。
4. Vercel 使用 Node 24 和仓库中的 `vercel.json`。构建成功后自动建表、同步 Git 题库。
5. 域名取当前请求 origin，生产修改请求必须同源；无需额外的域名环境变量。自定义域名在 Vercel Domains 中管理。

Neon 集成产品描述采用[官方 Vercel/Neon 模板](https://github.com/neondatabase-labs/vercel-marketplace-neon)的 Deploy Button 配置。集成的创建、计费和授权由 Vercel/Neon 页面完成，本项目不代替用户接受这些步骤。

### 你的站点已有 Vercel 项目

在项目 Storage / Marketplace 中添加 Neon PostgreSQL 并连接当前项目，确认 `DATABASE_URL` 已注入。在 Settings → Environment Variables 选择凭证模式、站点服务并填入对应 Key，再重新部署。

| 变量 | 来源与用途 |
| --- | --- |
| `AI_ACCESS_MODE` | `byok_only`（默认）、`site_only` 或 `both` |
| `AI_SITE_PROVIDER` | 站点服务：`vercel`（默认）、`typesafe` 或 `openrouter` |
| `AI_GATEWAY_API_KEY` | 选择 `vercel` 时的站点 Key |
| `TYPESAFE_API_KEY` | 选择 `typesafe` 时的站点 Key |
| `OPENROUTER_API_KEY` | 选择 `openrouter` 时的站点 Key |
| `DATABASE_URL` | Neon 集成自动注入的服务端数据库连接串；也接受其他 PostgreSQL |

只需提供所选站点服务的 Key；缺失时构建会失败，不会借用其他服务的 Key。BYOK 玩家在设置中独立选择服务，不受 `AI_SITE_PROVIDER` 限制。模型均为 Jev，还原判断与私有创作/分享始终启用。

### 使用 TypeSafe 官方 Key 或 OpenRouter

例如开放 TypeSafe 官方 Key，同时允许玩家自带 Key：

```dotenv
AI_ACCESS_MODE=both
AI_SITE_PROVIDER=typesafe
```

在 Vercel 的 Production 环境添加 `TYPESAFE_API_KEY`，然后重新部署。使用 OpenRouter 时改为 `AI_SITE_PROVIDER=openrouter` 并添加 `OPENROUTER_API_KEY`。这些配置也适用于 Docker 的 `.env`。

### 关闭站点 Key

设置 `AI_ACCESS_MODE=byok_only` 并重新部署；界面隐藏站点 Key 入口，后端拒绝新的站点 Key 调用，玩家仍可使用自己的三种服务 Key。查询已有结果不需要模型 Key。该设置只对新部署生效，旧部署可能仍可调用原 Key；要停用所有旧部署的同一凭证，还需在供应商处撤销它。

### 密钥与更新

密钥只填在 Vercel Environment Variables；更新后重新部署。可用交互式 CLI：

```sh
vercel link
vercel env add AI_GATEWAY_API_KEY production
vercel --prod
```

不要将真实凭证写进按钮 URL、README、`vercel.json` 或公开客户端变量。真实 `.env*`、`.vercel/`、本地数据库均被 Git 和 Vercel 上传配置排除。

每个 Vercel 环境必须连接自己的数据库；构建会初始化并同步该数据库，缺少连接串会明确失败。Preview 使用隔离的 Neon 数据库/分支，不可向外部 PR 暴露生产连接和站点 Key。新建或复用分支按集成的实际配置检查，不假定已自动隔离。

建表操作可重复执行，但不是未来结构升级的版本化迁移方案。发布到同一数据库时串行部署并提前备份；若数据库同步完成后 Vercel 后续发布失败，数据库变更不会自动回滚。非 Vercel 部署手动执行 `npm run db:migrate`、`npm run content:sync`。

维护者更换 GitHub 仓库后，可运行 `npm run deploy:button -- OWNER/REPOSITORY` 更新双语 README 按钮。按钮只携带非敏感配置。

参考：[Vercel Postgres](https://vercel.com/docs/postgres)、[Marketplace Storage](https://vercel.com/docs/marketplace-storage)、[部署按钮环境变量](https://vercel.com/docs/deploy-button/environment-variables)。

## 腾讯云 Docker

需要先安装 Docker Compose，域名解析到服务器。创建被 Git 忽略的 `.env`，至少包含：

```dotenv
DOMAIN=soup.example.com
POSTGRES_PASSWORD=replace-with-a-long-random-alphanumeric-password
AI_ACCESS_MODE=byok_only
```

密码用于数据库 URL 时须适当 URL 编码；以上建议直接使用足够长的随机字母数字串。

```sh
docker compose up --build -d
```

migrate 服务先初始化数据库并同步 Git 题库；app 使用 Next standalone 输出；Caddy 提供 HTTPS。仅代理暴露 80/443，数据库不暴露公网端口。首次域名/TLS 建立要检查日志。Docker 路径需要在目标服务器验证；源码构建检查不等于容器或生产部署验收。

升级先备份，手动运行新的迁移，再切换应用版本。不要依赖重新执行旧的一次性迁移容器自动升级未来数据库结构。备份例如通过 `docker compose exec -T db pg_dump -U soupbase soupbase` 导出到受保护位置，并保存到另一机器；定期恢复演练。


## 运行数据

软删除立即阻断访问，物理删除由维护命令处理；数据库备份可能暂留旧内容。上线时设定并公布备份保留周期。每日运行 cleanup 属于部署者的运行安排，应用不内置匿名配额和账单系统。
