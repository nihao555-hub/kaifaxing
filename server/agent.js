import { chat, parseJson } from './ai.js';
import { config } from './config.js';

// ============================================================
// 外贸开发信 AI Agent
// 职责：
//  1. 针对每位客户生成高度个性化、直击痛点的开发信（英文）
//  2. 对开发信进行多维度评分与改进建议
//  3. 根据收件人时区计算最佳发送时间（当地周二~周四上午 9-11 点）
// ============================================================

const WRITER_SYSTEM_PROMPT = `你是一位顶尖的外贸开发信（Cold Email）专家 Agent，服务于一家中国出口商。你必须根据客户的行业与职位，自动判断最匹配的产品方向（例如对方做五金分销就谈工具/五金，做灯具零售就谈照明），写出让采购决策者很难随手关掉的开发信。

目标：对方打开后 10 秒内感到「这封信是专门写给我的」，并觉得拒绝的成本高于点开回复。

写信必须遵守以下原则：

【主题行】
- 8 个单词以内，制造好奇心或直接点出对方利益，禁止标题党和垃圾词（free、100%、urgent、winner 等）
- 尽量包含对方公司名或一个具体利益点，提高打开率

【正文结构（AIDA，必须让人很难拒绝）】
1. 开头 1 句：证明"我研究过你"——引用对方公司近况、渠道结构、行业趋势或其岗位职责。绝不用 "I hope this email finds you well" / "My name is"
2. 痛点直击：只抓一个最痛的点（交期、成本、品控、MOQ、认证、售后、供应商集中度等），用对方会点头的行业语言，让他觉得"你懂我"
3. 价值主张：用具体数字说明我们能带来什么（如 15 天交期、7 天打样、MOQ 200、CE/UL/FDA 认证、不良率 <0.3%），突出与现有供应商的差异化。不要空喊 "high quality"
4. 社会证明：1 句提及服务过的同行业客户类型或成果（可合理泛化，不得虚构具体虚假公司名）
5. CTA：低门槛、明确、唯一，让拒绝变得不自然——优先用 "I can send a 1-page spec + pricing for your SKU" 或 "15-min call this week, or I can just email the catalog" 这种二选一

【风格】
- 全文 90-120 词（不含签名），短段落、口语化商务英语，好读好回
- 一封信只推一个产品方向、一个 CTA
- 署名 Alice

严格按 JSON 输出（一次同时给出信件和评分，不要 markdown）：
{
  "subject": "...",
  "body": "...",
  "painPointAnalysis": "用中文简述抓住了哪个痛点、为什么对方很难拒绝",
  "dimensions": [
    {"key": "主题吸引力", "score": 85},
    {"key": "内容相关性", "score": 90},
    {"key": "个性化程度", "score": 80},
    {"key": "行动号召", "score": 86},
    {"key": "整体可读性", "score": 88}
  ],
  "suggestion": "一段中文改进建议（60 字以内）"
}
body 中用 \\n\\n 分段，不要包含主题行。`;

export async function generateEmail(customer, extraContext = '') {
  const user = `请为以下客户撰写一封开发信：

- 姓名：${customer.name}
- 公司：${customer.company}
- 职位：${customer.title}
- 国家/地区：${customer.country}（时区 ${customer.timezone}）
- 所在行业：${customer.industry || '未知'}
- 已知痛点/背景：${customer.painPoints || '未知，请根据行业和职位合理推断'}
${extraContext ? `- 补充要求：${extraContext}` : ''}

输出 JSON。`;

  const text = await chat(
    [
      { role: 'system', content: WRITER_SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    { temperature: 0.8 }
  );
  const json = parseJson(text);
  const draft = {
    subject: String(json.subject || '').trim(),
    body: String(json.body || '').trim(),
    painPointAnalysis: String(json.painPointAnalysis || '').trim(),
  };
  const evaluation = json.dimensions ? scoreFromDimensions(json.dimensions, json.suggestion) : null;
  return { ...draft, evaluation };
}

function scoreFromDimensions(rawDims, suggestion) {
  const dims = (rawDims || []).map((d) => ({
    key: String(d.key),
    score: Math.max(0, Math.min(100, Math.round(Number(d.score) || 0))),
  }));
  const total = dims.length
    ? Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length)
    : 0;
  const grade = total >= 85 ? '优秀' : total >= 70 ? '良好' : total >= 60 ? '及格' : '待改进';
  return { total, grade, dimensions: dims, suggestion: String(suggestion || '').trim() };
}

const EVALUATOR_SYSTEM_PROMPT = `你是一位外贸开发信质量评估专家。请从收件人（海外采购决策者）的视角，对给定的开发信进行严格评分。

评分维度（各 0-100）：
1. 主题吸引力：主题行是否让人想点开，是否规避垃圾邮件特征
2. 内容相关性：内容是否贴合客户的行业、职位与业务场景
3. 个性化程度：是否体现出对该客户的专门研究，而非群发模板
4. 行动号召：CTA 是否清晰、低门槛、易于回复
5. 整体可读性：篇幅、分段、语言是否简洁流畅

严格按 JSON 输出：
{"dimensions": [{"key": "主题吸引力", "score": 85}, {"key": "内容相关性", "score": 90}, {"key": "个性化程度", "score": 80}, {"key": "行动号召", "score": 86}, {"key": "整体可读性", "score": 88}], "suggestion": "一段中文改进建议（60 字以内）"}`;

export async function evaluateEmail({ subject, body, customer }) {
  const user = `客户背景：${customer ? `${customer.name}，${customer.company}，${customer.title}，${customer.industry || ''}` : '未知'}

主题：${subject}

正文：
${body}

输出 JSON。`;

  const text = await chat(
    [
      { role: 'system', content: EVALUATOR_SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    { temperature: 0.3 }
  );
  const json = parseJson(text);
  return scoreFromDimensions(json.dimensions, json.suggestion);
}

// ============================================================
// 时区智能调度：计算收件人当地"周二~周四 上午 9-11 点"的下一个发送窗口
// ============================================================

function partsInTimezone(date, timezone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const map = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  const weekdayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(map.weekday);
  return {
    weekday: weekdayIdx,
    hour: Number(map.hour === '24' ? 0 : map.hour),
    minute: Number(map.minute),
    dateStr: `${map.year}-${map.month}-${map.day}`,
  };
}

/**
 * 返回 { sendAt: Date, localTime: string, reason: string }
 * 策略：
 *  - 若收件人当地此刻正处于工作日 9:00-11:00 黄金窗口 → 立即发送
 *  - 否则推迟到下一个"周二/周三/周四 9:00-11:00（随机分钟）"当地时间
 */
export function suggestSendTime(timezone, from = new Date()) {
  const s = config.sending;
  const now = partsInTimezone(from, timezone);

  if (s.allowedWeekdays.includes(now.weekday) && now.hour >= s.bestHourStart && now.hour < s.bestHourEnd) {
    return {
      sendAt: from,
      localTime: `当地 ${now.dateStr} ${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`,
      reason: '收件人当地正处于工作日上午 9-11 点黄金打开时段，立即发送',
    };
  }

  // 以 15 分钟为步长向后扫描，找到下一个"首选工作日 + 黄金时段"的时间点
  const step = 15 * 60 * 1000;
  let t = new Date(from.getTime() + step);
  const targetMinute = 5 + Math.floor(Math.random() * 50); // 随机分钟，避免整点集中发送
  for (let i = 0; i < 4 * 24 * 8; i++) {
    const p = partsInTimezone(t, timezone);
    const dayOk = s.preferredWeekdays.includes(p.weekday);
    if (dayOk && p.hour === s.bestHourStart && p.minute < 15) {
      const sendAt = new Date(t.getTime() + targetMinute * 60 * 1000);
      const lp = partsInTimezone(sendAt, timezone);
      return {
        sendAt,
        localTime: `当地 ${lp.dateStr} ${String(lp.hour).padStart(2, '0')}:${String(lp.minute).padStart(2, '0')}`,
        reason: '已避开周末与非工作时段，安排在收件人当地周二~周四上午 9-11 点黄金窗口',
      };
    }
    t = new Date(t.getTime() + step);
  }
  return { sendAt: from, localTime: '', reason: '未找到最佳窗口，按当前时间发送' };
}
