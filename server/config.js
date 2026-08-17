import { loadDotEnv } from './loadEnv.js';

loadDotEnv();

// 全局配置：凭据只从环境变量 / 本地 secrets 读取，不写入 Git。
export const config = {
  port: Number(process.env.PORT || 3001),

  // ===== SMTP 发信配置（163 邮箱）=====
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.163.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    senderName: process.env.SENDER_NAME || 'Alice | OutreachAI',
  },

  // ===== AI 模型配置（grsai 旧版 Chat API，与 OpenAI 接口一致）=====
  ai: {
    // 海外 Host：https://grsaiapi.com  国内直连：https://grsai.dakka.com.cn
    baseUrl: process.env.AI_BASE_URL || 'https://grsaiapi.com',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-5.6-sol',
  },

  // ===== 批量发送策略（保护发信域名信誉，避免进垃圾箱）=====
  sending: {
    // 相邻两封邮件的最小/最大间隔（秒），实际取区间内随机值，模拟人工发送节奏
    minIntervalSec: Number(process.env.SEND_MIN_INTERVAL || 45),
    maxIntervalSec: Number(process.env.SEND_MAX_INTERVAL || 120),
    // 单日发送上限（163 个人邮箱建议不超过 50 封/天）
    dailyLimit: Number(process.env.SEND_DAILY_LIMIT || 50),
    // 收件人当地时间的最佳发送窗口（外贸开发信黄金时段：上午 9-11 点）
    bestHourStart: 9,
    bestHourEnd: 11,
    // 避开周末（周六=6，周日=0），最佳发送日为周二~周四
    preferredWeekdays: [2, 3, 4],
    allowedWeekdays: [1, 2, 3, 4, 5],
    // 低于此分自动按 AI 建议重写一次
    minScore: Number(process.env.MIN_SCORE || 80),
    // 首封发出后，对方当地工作日满 N 天仍未回复则自动跟进
    followupDays: Number(process.env.FOLLOWUP_DAYS || 3),
    maxFollowups: Number(process.env.MAX_FOLLOWUPS || 2),
  },

  samApiKey: process.env.SAM_API_KEY || '',
  companiesHouse: {
    apiKey: process.env.COMPANIES_HOUSE_API_KEY || '',
  },
  openCorporates: {
    apiKey: process.env.OPENCORPORATES_API_KEY || '',
  },

  // 谷歌搜索：默认走官方 Custom Search JSON API，不抓 google.com HTML
  google: {
    apiKey: process.env.GOOGLE_API_KEY || '',
    cseId: process.env.GOOGLE_CSE_ID || process.env.GOOGLE_CX || '',
    serperKey: process.env.SERPER_API_KEY || '',
    engine: process.env.SEARCH_ENGINE || 'google',
  },

  // 阿里国际站官方开放平台（ICBU RFQ），不爬页面
  alibaba: {
    appKey: process.env.ALIBABA_APP_KEY || '',
    appSecret: process.env.ALIBABA_APP_SECRET || '',
    session: process.env.ALIBABA_SESSION || '',
    gateway: process.env.ALIBABA_GATEWAY || 'https://eco.taobao.com/router/rest',
  },

  // 询盘获客：按网易外贸通「每日入库 + 自动背调」
  pipeline: {
    timezone: process.env.PIPELINE_TZ || 'Asia/Shanghai',
    dailyHour: Number(process.env.PIPELINE_DAILY_HOUR || 7),
    refreshHours: Number(process.env.PIPELINE_REFRESH_HOURS || 6),
    researchDelayMs: Number(process.env.PIPELINE_RESEARCH_DELAY_MS || 800),
    researchConcurrency: Number(process.env.PIPELINE_RESEARCH_CONCURRENCY || 4),
    backlogPerDay: Number(process.env.PIPELINE_BACKLOG_PER_DAY || 30),
    alibabaPages: Number(process.env.PIPELINE_ALIBABA_PAGES || 8),
    govLimit: Number(process.env.PIPELINE_GOV_LIMIT || 40),
  },

  imap: {
    host: process.env.IMAP_HOST || 'imap.163.com',
    port: Number(process.env.IMAP_PORT || 993),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
};

export function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '••••';
  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

export function googleCseReady() {
  return Boolean(config.google.apiKey && config.google.cseId);
}

export function serperReady() {
  return Boolean(config.google.serperKey);
}

export function normalizeSearchEngine(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'serper') return 'serper';
  if (v === 'auto') return 'auto';
  return 'google';
}

export function preferredSearchEngine() {
  return normalizeSearchEngine(config.google.engine);
}

config.google.engine = preferredSearchEngine();

export function officialSearchReady() {
  const pref = preferredSearchEngine();
  if (pref === 'google') return googleCseReady();
  if (pref === 'serper') return serperReady();
  return googleCseReady() || serperReady();
}

export function googleSearchReady() {
  return officialSearchReady();
}

export function googleSearchStatus() {
  const engine = preferredSearchEngine();
  return {
    engine,
    cseReady: googleCseReady(),
    serperReady: serperReady(),
    ready: officialSearchReady(),
    needCse: engine === 'google' && !googleCseReady(),
    setup: engine === 'google' && !googleCseReady()
      ? '无密钥时谷歌结果页会被验证码挡住。背调改走必应/DuckDuckGo 公开结果 + GLEIF/Wikidata。要稳定的谷歌结果请配 GOOGLE_API_KEY 和 GOOGLE_CSE_ID。不会改走 Serper，也不会破解谷歌验证码。'
      : '',
    apiKeySet: Boolean(config.google.apiKey),
    cseIdSet: Boolean(config.google.cseId),
    serperSet: Boolean(config.google.serperKey),
    apiKeyMasked: maskSecret(config.google.apiKey),
    cseIdMasked: maskSecret(config.google.cseId),
    serperMasked: maskSecret(config.google.serperKey),
    companiesHouseReady: Boolean(config.companiesHouse.apiKey),
    openCorporatesReady: Boolean(config.openCorporates.apiKey),
    companiesHouseMasked: maskSecret(config.companiesHouse.apiKey),
    openCorporatesMasked: maskSecret(config.openCorporates.apiKey),
  };
}
