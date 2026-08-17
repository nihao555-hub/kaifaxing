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

function factLine(f) {
  return `- ${f.label}: ${String(f.value || '').slice(0, 180)}${f.source ? `（${f.source}）` : ''}`;
}

function officerLine(o) {
  if (!o) return '';
  if (typeof o === 'string') return o;
  return [o.name, o.title || o.role].filter(Boolean).join(' · ');
}

/** 开发信首封 / 质检用的公开核验上下文。只喂已入库字段，不重新搜人。 */
export function buildWriterBrief(customer = {}) {
  const r = customer.research || {};
  const intel = r.intel || {};
  const facts = (r.facts || []).slice(0, 10).map(factLine);
  const officers = (r.officers || intel.officers || []).slice(0, 6).map(officerLine).filter(Boolean);
  const risks = (r.risks || r.kyb?.risks || []).slice(0, 4).map(String);
  const traces = (intel.traces || []).slice(0, 4).map((t) => (typeof t === 'string' ? t : t.title || t.value || '')).filter(Boolean);
  return `【客户档案】
姓名：${customer.name || ''}
公司：${customer.company || ''}
法定名称：${customer.legalName || r.legalName || customer.company || ''}
职位：${customer.title || ''}
国家/地区：${customer.country || ''}（时区 ${customer.timezone || ''}）
行业：${customer.industry || r.industry || ''}
官网：${customer.website || r.website || intel.website || '未知'}
开发信收件邮箱：${customer.email || r.outreach?.email || ''}
来源：${[customer.source, customer.sourceUrl || customer.awardId].filter(Boolean).join(' ')}
已知痛点/招标摘要：${customer.painPoints || '未知，请根据行业和职位合理推断'}

【公开背调（必须引用至少一处可核验事实，不得编造公司近况或职务）】
分级：${r.kyb?.grade || r.grade || '未知'}
背调摘要：${String(r.brief || '').slice(0, 500) || '无'}
核验事实：
${facts.join('\n') || '- 无'}
母公司：${intel.parent || '未知'}
公开职务：${officers.join('；') || '未在公开页核到'}
招标/采购痕迹：${traces.join('；') || '无'}
开发信建议：${r.outreachAdvice || r.outreach?.reason || ''}
风险：${risks.join('；') || '无'}`;
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
    brief: `${buildWriterBrief(customer)}
当前状态：${customer.status || ''}

【完整沟通时间线】
${timeline.join('\n\n') || '（尚无历史，这是第一封回复）'}

【我们已在往期邮件中提到、回信时不得自相矛盾的要点】
${promises.length ? promises.map((p) => `- ${p}`).join('\n') : '- 尚无明确数字承诺'}

【对方最新来信（已去掉引用原文）】
主题：${inbound?.subject || ''}
${inboundClean || '（正文为空）'}`,
  };
}
