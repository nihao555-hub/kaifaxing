const FORWARDER_RE = /freight|forwarder|logistics|货代|shipping agency|customs broker/i;

export function isForwarderName(name) {
  return FORWARDER_RE.test(String(name || ''));
}

const VERIFIED_SOURCES = new Set([
  'GLEIF', 'Wikidata', 'Sirene', 'ROR', 'Brreg', 'PRH', 'ARES', 'Receita', 'Companies House',
]);

export function hasVerifiedEntity(facts = []) {
  return facts.some((f) => VERIFIED_SOURCES.has(f.source));
}

export function hasProcurementTrace(customer = {}, traces = []) {
  if (customer.sourceUrl || customer.awardId || customer.rfq) return true;
  if (/USASpending|Contracts Finder|TED|World Bank|SAM/i.test(customer.source || '')) return true;
  return traces.some((t) => t.source && t.source !== '询盘');
}

/**
 * 业界常用报价前分级：A 可写开发信 / B 走表单或补登记号 / C 停。
 * 不把「查到很多网页」当成 A。
 */
export function gradeKyb({
  personLike = false,
  forwarder = false,
  verified = false,
  website = '',
  emails = [],
  sanctions = [],
  procurement = false,
  legalName = '',
} = {}) {
  const risks = [];
  let needRegNo = false;

  if (personLike) {
    return {
      grade: 'C',
      label: '停',
      nextAction: '只有个人昵称。向对方要法定全称和登记号后再查，不要猜私人邮箱。',
      needRegNo: true,
      risks: ['显示名无法核验', '猜测私人邮箱属违规获客'],
    };
  }
  if (sanctions.length) {
    return {
      grade: 'C',
      label: '停',
      nextAction: '公开制裁名单命中，不要写开发信，不要录入发信名单。',
      needRegNo: false,
      risks: sanctions.map((h) => `制裁名单：${h.name}（${h.list}）`).slice(0, 3),
    };
  }
  if (forwarder) {
    return {
      grade: 'C',
      label: '停',
      nextAction: '名称像货代/物流，不是采购主体。不要当买家开发。',
      needRegNo: false,
      risks: ['询盘方可能是货代，不是货主'],
    };
  }

  const hasMail = emails.length > 0;
  if (verified && website && hasMail) {
    if (!procurement) risks.push('还没有海关/招标采购痕迹，报价前先确认品类是否匹配');
    risks.push('公开角色邮箱不一定是采购决策人');
    return {
      grade: 'A',
      label: '可写开发信',
      nextAction: `可向 ${emails[0].email} 写开发信。大额、寄样或账期再补中国信保/D&B 信用报告。`,
      needRegNo: false,
      risks,
    };
  }

  if (verified && website) {
    risks.push('官网可打开，联系方式多为表单');
    return {
      grade: 'B',
      label: '走表单',
      nextAction: '主体和官网已核到，没有明文角色邮箱。走官网表单或招标规定渠道，不要编造邮箱。',
      needRegNo: false,
      risks,
    };
  }

  if (verified || website) {
    needRegNo = !verified;
    if (needRegNo) risks.push('公开库主体未齐，询盘名、付款主体、收货主体可能不是同一家');
    if (!website) risks.push('还没有核验通过的官网');
    return {
      grade: 'B',
      label: '补资料',
      nextAction: needRegNo
        ? `向对方要登记号和付款主体全称（现用名「${legalName || '未知'}」），核完再报价。`
        : '主体未齐。先走询盘原渠道，不要用未验证域名发信。',
      needRegNo,
      risks,
    };
  }

  return {
    grade: 'C',
    label: '停',
    nextAction: '公开库核不到公司。向对方要法定全称、登记号和官网后再查。',
    needRegNo: true,
    risks: ['无法核验法律主体', '继续搜私人邮箱没有背调价值'],
  };
}
