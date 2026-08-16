// 把客户档案 + 完整来往整理成回信/跟进可用的上下文，避免只看最后一封

const PROMISE_RE =
  /(\bMOQ\b|\b\d+\s*-?\s*day|\bUL\b|\bCE\b|\bFDA\b|\bETL\b|\b0\.3%|\bsample|\bpricing|\bspec\b)/i;

export function stripQuotedReply(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n');
  const cut = lines.findIndex(
    (l) =>
      /^on .+wrote:$/i.test(l.trim()) ||
      l.startsWith('-----Original Message-----') ||
      l.startsWith('________') ||
      /^from:\s/i.test(l) && lines[lines.indexOf(l) + 1]?.toLowerCase().startsWith('sent:')
  );
  const kept = (cut === -1 ? lines : lines.slice(0, cut))
    .filter((l) => !l.startsWith('>'))
    .join('\n')
    .trim();
  return kept || raw.trim();
}

export function extractPromises(thread = []) {
  const hits = [];
  for (const t of thread.filter((x) => x.type === 'outbound')) {
    for (const line of String(t.body || '').split('\n')) {
      if (PROMISE_RE.test(line)) hits.push(line.trim());
    }
  }
  return [...new Set(hits)].slice(0, 12);
}

export function buildConversationBrief(customer, thread = [], inbound) {
  const timeline = (thread || []).map((t, i) => {
    const who = t.type === 'inbound' ? `客户 ${customer.name}` : '我们 (Alice)';
    const body = stripQuotedReply(t.body).slice(0, 500);
    return `${i + 1}. [${t.time || ''}] ${who}\n   主题：${t.subject || t.label || ''}\n   ${body}`;
  });

  const inboundClean = stripQuotedReply(inbound?.body || '');
  const promises = extractPromises(thread);

  return {
    inboundClean,
    promises,
    brief: `【客户档案】
姓名：${customer.name}
公司：${customer.company}
职位：${customer.title || ''}
国家/时区：${customer.country || ''} / ${customer.timezone || ''}
行业：${customer.industry || ''}
已知痛点：${customer.painPoints || '无'}
当前状态：${customer.status}

【完整沟通时间线】
${timeline.join('\n\n') || '（尚无历史，这是第一封回复）'}

【我们已在往期邮件中提到、回信时不得自相矛盾的要点】
${promises.length ? promises.map((p) => `- ${p}`).join('\n') : '- 尚无明确数字承诺'}

【对方最新来信（已去掉引用原文）】
主题：${inbound?.subject || ''}
${inboundClean || '（正文为空）'}`,
  };
}
