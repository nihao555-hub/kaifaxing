// 全局配置：优先读环境变量，未设置时使用默认值（用户提供的账号）
export const config = {
  port: Number(process.env.PORT || 3001),

  // ===== SMTP 发信配置（163 邮箱）=====
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.163.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    user: process.env.SMTP_USER || '15571870062@163.com',
    pass: process.env.SMTP_PASS || 'PB8dPj25kfvGVitE',
    senderName: process.env.SENDER_NAME || 'Alice | OutreachAI',
  },

  // ===== AI 模型配置（grsai 旧版 Chat API，与 OpenAI 接口一致）=====
  ai: {
    // 海外 Host：https://grsaiapi.com  国内直连：https://grsai.dakka.com.cn
    baseUrl: process.env.AI_BASE_URL || 'https://grsaiapi.com',
    apiKey: process.env.AI_API_KEY || 'sk-70f67a051b1848f094cf270410772c81',
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

  imap: {
    host: process.env.IMAP_HOST || 'imap.163.com',
    port: Number(process.env.IMAP_PORT || 993),
    user: process.env.SMTP_USER || '15571870062@163.com',
    pass: process.env.SMTP_PASS || 'PB8dPj25kfvGVitE',
  },
};
