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
  return [o.name, o.title || o.role, o.source ? `（${o.source}）` : ''].filter(Boolean).join(' · ').replace(' · （', '（');
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&agrave;/gi, 'à')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function companySocials(list = []) {
  return list
    .map((s) => (typeof s === 'string' ? { url: s, label: '' } : s))
    .filter((s) => {
      const url = String(s.url || '');
      if (/linkedin\.com\/in\//i.test(url) || /linkedin\.com\/pub\//i.test(url)) return false;
      return /linkedin\.com\/company\//i.test(url) || /facebook\.com\//i.test(url);
    })
    .slice(0, 4)
    .map((s) => `${s.label || '社媒'} ${s.url}`);
}

function inquiryBlock(customer = {}) {
  const card = customer.publicCard || {};
  const qty = [card.quantity || customer.quantity, card.quantityUnit || card.quantityValueUnit]
    .filter(Boolean)
    .join(' ');
  const lines = [
    `来源：${[customer.source, customer.sourceUrl || customer.awardId].filter(Boolean).join(' ')}`,
    `询盘/招标标题：${decodeEntities(card.subject || customer.product || customer.title || customer.rfq?.title || '') || '无'}`,
    `品类：${customer.categoryName || card.categoryName || '未标注'}`,
    `数量：${qty || '未标注'}`,
    `发布：${customer.postedDate || customer.postedAt || card.postedAt || card.openTimeStr || '未标注'}`,
    `截止：${card.expirationTime || ''}`.replace(/截止：$/, ''),
    `买家显示名（可能是昵称，不是法定主体）：${card.buyerName || customer.buyer || customer.name || ''}`,
    `附件：${card.haveAnnexes || customer.haveAnnexes ? '列表标记有附件（未登录不下载）' : '未见附件'}`,
    `询盘/招标正文：${decodeEntities(card.description || customer.rfq?.description || customer.painPoints || '').slice(0, 900) || '无'}`,
  ];
  return lines.filter((l) => !l.endsWith('：') && !l.endsWith('未标注') || /标题|正文|来源|显示名/.test(l)).join('\n');
}

/** 开发信首封 / 质检用的公开核验上下文。只喂已入库字段，不搜人名、不猜私人邮箱。 */
export function buildWriterBrief(customer = {}) {
  const r = customer.research || {};
  const intel = r.intel || {};
  const facts = (r.facts || []).slice(0, 12).map(factLine);
  const officers = (r.officers || intel.officers || []).slice(0, 6).map(officerLine).filter(Boolean);
  const risks = (r.risks || r.kyb?.risks || []).slice(0, 4).map(String);
  const traces = (intel.traces || []).slice(0, 4).map((t) => (typeof t === 'string' ? t : t.title || t.value || '')).filter(Boolean);
  const socials = companySocials(r.socials || intel.socials || []);
  const roleMails = (r.emails || [])
    .map((e) => (typeof e === 'string' ? e : e.email))
    .filter(Boolean)
    .slice(0, 6);
  return `【询盘 / 招标原文——写信必须点名其中的货物、数量、型号或截止日期，不能只写行业套话】
${inquiryBlock(customer)}

【客户档案】
姓名：${customer.name || ''}
公司：${customer.company || ''}
法定名称：${customer.legalName || r.legalName || customer.company || ''}
职位：${customer.title || ''}
国家/地区：${customer.country || ''}（时区 ${customer.timezone || ''}）
行业：${customer.industry || r.industry || ''}
官网：${customer.website || r.website || intel.website || '未知'}
开发信收件邮箱（角色箱，不要改成私人邮箱）：${customer.email || r.outreach?.email || ''}
官网出现的其他角色邮箱：${roleMails.join('、') || '无'}
公司主页（仅 company 页，不是个人主页）：${socials.join('；') || '未核到'}

【公开背调——必须再引用至少一处可核验事实（官网/登记地址/LEI/法定名称），不得编造近况或职务】
分级：${r.kyb?.grade || r.grade || '未知'}
背调摘要：${String(r.brief || '').slice(0, 600) || '无'}
核验事实：
${facts.join('\n') || '- 无'}
母公司：${intel.parent || '未知'}
公开职务（招标原文或官网领导页的姓名+职务，没有私人邮箱）：${officers.join('；') || '未在公开页核到'}
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
