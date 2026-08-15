# OutreachAI — AI 批量开发信助手（外贸获客）

按 UI 设计稿一比一复刻的外贸开发信工具：AI Agent 针对每位客户研究痛点、生成个性化英文开发信并自动评分，随后按收件人时区智能调度、以防封频率批量发送。

## 功能

- **一比一复刻 UI**：左侧导航（开发信/模板/数据分析/设置）、客户名单（搜索/状态筛选/分页）、沟通历史时间轴、右侧「AI 生成的开发信内容」+「AI 评估」面板
- **AI Agent（gpt-5.6-sol）**
  - 按 AIDA 结构撰写开发信：开头证明"研究过你" → 直击痛点 → 数字化价值主张 → 社会证明 → 低门槛 CTA，全文 120 词以内
  - 五维评分：主题吸引力 / 内容相关性 / 个性化程度 / 行动号召 / 整体可读性 + 改进建议
- **批量发送（核心）**：选客户 → AI 逐个生成（可编辑）→ 选择发送策略 → 后台按计划发送、实时进度
- **时区智能调度**：自动安排在收件人当地**周二~周四上午 9-11 点**黄金打开时段，避开周末与深夜
- **发信频率保护**：相邻两封随机间隔 45-120 秒模拟人工节奏；单日上限 50 封，保护 163 账号信誉

## 快速开始

```bash
npm run install:all   # 安装根目录 + server + web 依赖
npm run dev           # 同时启动后端(3001)和前端(5173)
```

打开 http://localhost:5173 即可使用。

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
