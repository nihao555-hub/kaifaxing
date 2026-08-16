# OutreachAI — AI 批量开发信助手（外贸获客）

按 UI 设计稿一比一复刻的外贸开发信工具：AI Agent 针对每位客户研究痛点、生成个性化英文开发信并自动评分，随后按收件人时区智能调度、以防封频率批量发送。

## 功能

- **一比一复刻 UI**：左侧导航（开发信/询盘获客/模板/数据分析/设置）、客户名单（搜索/状态筛选/分页）、沟通历史时间轴、右侧「AI 生成的开发信内容」+「AI 评估」面板
- **询盘获客页（网易外贸通节奏）**：每天北京时间 07:00 拉当天新询盘，日间每 6 小时再扫一轮；入库后自动公开背调。高置信度的 info / procurement 等角色邮箱自动写入，Agent 再按开发信流程联系。不扒私人邮箱、不绕登录墙。
- **AI Agent（gpt-5.6-sol）**
  - 按 AIDA 结构撰写开发信：开头证明"研究过你" → 直击痛点 → 数字化价值主张 → 社会证明 → 低门槛 CTA，全文 120 词以内
  - 五维评分：主题吸引力 / 内容相关性 / 个性化程度 / 行动号召 / 整体可读性 + 改进建议
- **全自动 Agent（客户入库后无需人工点发送）**
  1. 用「+」录入**真实客户邮箱**（不能填自己的发件箱）
  2. Agent 研究痛点并起草开发信，低于 80 分按建议重写一次
  3. 按对方时区周二~周四上午 9-11 点排期，全球发信间隔 45-120 秒
  4. SMTP 发到真实客户邮箱；`*.example.com` 只演练不投递
  5. IMAP 扫描回复 → 标记「已回复」并自动起草回信发出
  6. 满 3 个工作日未回复 → 自动跟进（最多 2 封）
  人工只在现有列表 / 沟通历史 / 活动记录监控，必要时「更多操作」停止 Agent
- **批量发送（可选人工向导）**：选客户 → AI 逐个生成（可编辑）→ 选择发送策略 → 后台按计划发送、实时进度
- **时区智能调度**：自动安排在收件人当地**周二~周四上午 9-11 点**黄金打开时段，避开周末与深夜
- **发信频率保护**：相邻两封随机间隔 45-120 秒模拟人工节奏；单日上限 50 封，保护 163 账号信誉
- **RFQ 数据源（政府招标 + 商业询盘）**
  - **政府招标（已接通、免费官方接口）**：USASpending、英国 Contracts Finder、欧盟 TED、世界银行；配置 `SAM_API_KEY` 后带上 SAM.gov
  - **阿里国际站公开列表**：免登录拉询盘卡片（标题 / 买家显示名 / 国家 / 数量 / 发布时间），默认从 2026-07-01 起，限速翻页。无邮箱
  - **阿里官方 API**（可选）：`alibaba.icbu.rfq.search`，需卖家 `ALIBABA_APP_KEY` / `SECRET` / `SESSION`
  - **付费聚合 / 其他平台**：没有合法免费的「全球所有商业 RFQ」单一 API。TendersOnTime、dgMarket、中国制造网导出等用 `POST /api/rfq/ingest` 灌入
  - 无公开邮箱的线索入库后不会自动发信

## 快速开始

```bash
npm run install:all   # 安装根目录 + server + web 依赖
npm run dev           # 同时启动后端(3001)和前端(5173)
```

打开 http://localhost:5173 即可使用。客户名单旁的数据库图标分两栏：政府招标（已接通官方接口）和商业询盘（阿里官方 API + JSON 导入）。

阿里国际站：用卖家账号在开放平台创建应用，申请 `alibaba.icbu.rfq.search`，授权后写入 `ALIBABA_APP_KEY` / `ALIBABA_APP_SECRET` / `ALIBABA_SESSION`。不爬页面。

阿里公开询盘大约 96% 只有买家昵称。这类不能搜谷歌。在询盘抽屉「补主体」填入后台看到的法定全称/登记号后，会按公司名再跑背调。配置 `ALIBABA_APP_KEY` / `SECRET` / `SESSION` 后，官方 `alibaba.icbu.rfq.search` 若返回 `buyer_company_name` 也会当公司名查。

谷歌搜索：不要抓 `google.com/search` HTML（会被验证码挡住）。GitHub 上能接的是官方 [`googleapis` Custom Search](https://github.com/googleapis/google-api-nodejs-client)：

1. 打开 [Programmable Search Engine](https://programmablesearchengine.google.com/) 新建搜索引擎，勾选 Search the entire web，记下 CX
2. 在 Google Cloud 启用 Custom Search API，创建 API Key
3. 写入 `GOOGLE_API_KEY` / `GOOGLE_CSE_ID`，或在应用「设置」页保存后点「试跑」

免费额度约 100 次/天。新账号若已无法开通 CSE，可改用 Serper（同一套外贸公式，返回谷歌结果 JSON）。公共 SearXNG / 直接扒谷歌页在服务器上会被 403/验证码挡住，不会去绕。

其他付费聚合（TendersOnTime、dgMarket 等）或卖家后台导出：

```bash
curl -X POST http://localhost:3001/api/rfq/ingest \
  -H 'Content-Type: application/json' \
  -d '{"source":"TendersOnTime","items":[{"company":"Acme GmbH","email":"procurement@acme.example","country":"德国","painPoints":"Need 500 drills"}]}'
```

生产部署：

```bash
npm run build && npm start   # 后端 3001 端口同时托管前端构建产物
```

## 配置

默认配置写在 `server/config.js`（含 163 SMTP 账号与 grsai API Key），可用环境变量覆盖：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SMTP_HOST` / `SMTP_PORT` | SMTP 服务器 | smtp.163.com / 465 |
| `SMTP_USER` / `SMTP_PASS` | 发信邮箱 / SMTP 授权码 | 15571870062@163.com |
| `AI_BASE_URL` | grsai 接口地址（国内可换 https://grsai.dakka.com.cn） | https://grsaiapi.com |
| `AI_API_KEY` / `AI_MODEL` | API Key / 模型 | gpt-5.6-sol |
| `SEND_MIN_INTERVAL` / `SEND_MAX_INTERVAL` | 发信间隔（秒） | 45 / 120 |
| `SEND_DAILY_LIMIT` | 单日发送上限 | 50 |
| `SAM_API_KEY` | SAM.gov Public API Key（可选） | 空 |
| `ALIBABA_APP_KEY` / `ALIBABA_APP_SECRET` / `ALIBABA_SESSION` | 阿里国际站开放平台（可选） | 空 |
| `GOOGLE_API_KEY` / `GOOGLE_CSE_ID` | 谷歌官方 Custom Search JSON API（也可在「设置」里填） | 空 |
| `SERPER_API_KEY` | 可选，[serper.dev](https://serper.dev/) 谷歌 SERP JSON；CSE 没开通时用 | 空 |
| `PIPELINE_DAILY_HOUR` | 北京时间每日拉新询盘的整点 | 7 |
| `PIPELINE_REFRESH_HOURS` | 当天已同步后再扫一轮的间隔（小时） | 6 |

> ⚠️ 安全提示：仓库默认值中包含真实凭据，仅适合私有仓库使用；对外部署请改用环境变量并轮换密钥。

## 目录结构

```
server/            Express 后端
  agent.js         AI Agent（生成/评分/最佳发送时间）
  scheduler.js     批量任务调度（时区 + 频率控制）
  mailer.js        163 SMTP 发信
  data/seed.js     种子客户数据（与设计稿一致）
web/               React + Vite + Tailwind 前端
  src/components/  侧边栏 / 客户名单 / 沟通历史 / AI 面板 / 批量发送向导
```

种子客户的邮箱为 `*.example.com` 占位地址，请通过「添加客户」或修改 `server/data/seed.js` 填入真实客户邮箱后再发送。
