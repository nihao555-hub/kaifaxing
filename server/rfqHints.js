/** 从公开询盘正文抽法定名；公开缩略图只给浏览器以图搜图链接，不爬登录墙、不扒私人邮箱。 */

const LEGAL_SUFFIX = String.raw`(?:L\.?L\.?C\.?|Ltd\.?|Limited|GmbH|Mbh|Inc\.?|PLC|Pte\.?\s*Ltd\.?|Co\.?,?\s*Ltd\.?|S\.?A\.?S?\.?|B\.?V\.?|N\.?V\.?|Pty\.?\s*Ltd\.?|Pvt\.?\s*Ltd\.?|SARL|SRL)`;

const ATTRIBUTION = String.raw`(?:our\s+company(?:\s+name)?\s+is|company\s+name\s*(?:is|:)|i\s+(?:work|am)\s+(?:at|for|with|from)|i\s+represent|(?:we\s+are\s+)?representing|on\s+behalf\s+of|(?:executive\s+)?director\s+of|manager\s+of|this\s+is\s+[A-Z][a-zA-Z]+\s+from|i\s+am\s+[A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z]+\s+from|our\s+company(?!\s+is\s+looking)|we\s+are(?!\s+(?:seeking|looking|interested|from|representing|considering|reaching|planning|hoping|trying|sourcing|procuring|contacting|writing|a\s+(?:company|manufacturer|supplier|buyer|distributor))))`;

const JUNK_HINT = /\b(your|our|the|this|their|my|new|industrial)\s+company\b|\b(procuring|sourcing|considering|reaching|hardware|packaging|edition|screens?|galaxy|iphone|flavor|cotton|oem)\b/i;

const HINT_RE = new RegExp(
  `${ATTRIBUTION}\\s+([A-Z][A-Za-z0-9&.'\\-]+(?:\\s+[A-Z0-9][A-Za-z0-9&.'\\-]*){0,6}\\s+${LEGAL_SUFFIX})\\b`,
  'i',
);

const NAMED_ORG_RE = /(?:my\s+company\s+name\s+is|my\s+company\s+is\s+called|company\s+name\s*(?:is|:)|on\s+behalf\s+of(?:\s+the)?)\s+([A-Z][A-Za-z0-9&.'\-]{1,}(?:\s+(?:and|&|of|the|for|[A-Z0-9][A-Za-z0-9&.'\-]{1,})){0,8})/i;

const BARE_LEGAL_RE = new RegExp(
  `\\b([A-Z][A-Za-z0-9&.'\\-]{1,}(?:\\s+(?:and|&|of|the|[A-Z][A-Za-z0-9&.'\\-]{1,}|Co\\.?)){0,6}\\s*,?\\s*${LEGAL_SUFFIX})\\b`,
  'g',
);

const AFTER_NAME_OK = /^(?:[,.]{0,2}\s*(?:a|an|is|are|was|'s|established|based|focusing|located|regarding)|$)/i;
const PRODUCT_NAME = /\b(galaxy|iphone|screen|edition|series|type|model|flavor|cotton|oem|odm|jumbo|roll|tissue|wifi|amplifier|smps)\b/i;
const VERB_FIRST = /^(contacting|looking|seeking|reaching|interested|writing|trying|planning|hoping|sourcing|procuring|considering)$/i;

const ORG_TOKEN = /\b(Ltd|Limited|LLC|Inc|GmbH|SARL|PLC|Co|Group|Holdings|Enterprises|Authority|Hospital|College|University|Services|Equipment|Supplies|Department|Ministry|Council|Agency|Institute|Foundation|Clinic|School|Bureau|Commission|Association|Designs?|Healthcare|Standard|Quality|Boutique|Lighting|Engineering|Solutions|Products|Ecommerce|Consulting|Logistics|Trading|Technologies|Automations)\b/i;

const GERMAN_ORG = /(?:kuratorium|dienstleistungen|gesellschaft|handelsgesellschaft|stiftung|verein|genossenschaft)$/i;

const ORG_WORD = new Set([
  'ltd', 'limited', 'llc', 'gmbh', 'inc', 'plc', 'company', 'group', 'holdings',
  'enterprises', 'enterprise', 'services', 'service', 'solutions', 'products',
  'boutique', 'lighting', 'engineering', 'ecommerce', 'projects', 'automations',
  'designs', 'design', 'trading', 'technologies', 'consulting', 'consultants',
  'industries', 'logistics', 'manufacturing', 'equipment', 'supplies',
  'architectural', 'kuratorium', 'dienstleistungen', 'gesellschaft', 'verein',
  'stiftung', 'genossenschaft',
]);

function cleanHintName(raw, { cutSentence = false } = {}) {
  let s = String(raw || '').replace(/\([^)]{0,40}$/, '');
  if (cutSentence) s = s.replace(/\.\s*(We|Please|I|Need|Looking|Hello)\b.*$/i, '');
  return s.replace(/[.,;:]+$/, '').replace(/\s+/g, ' ').trim();
}

function looksLikeNamedOrg(name) {
  const words = cleanHintName(name, { cutSentence: true }).split(/\s+/).filter(Boolean);
  const kept = [];
  for (const w of words) {
    if (/^(and|&|of|the|for)$/i.test(w)) {
      if (kept.length) kept.push(w);
      continue;
    }
    if (!/^[A-Z]/.test(w)) break;
    kept.push(w);
  }
  const lastOrg = kept.reduce((idx, w, i) => (ORG_TOKEN.test(w) ? i : idx), -1);
  const clipped = lastOrg >= 0 ? kept.slice(0, lastOrg + 1) : kept;
  const s = clipped.join(' ').trim();
  if (s.length < 5 || s.length > 80) return '';
  if (/^(looking|interested|seeking|sourcing|purchasing|the brand|establishing|a partnership|interested in)\b/i.test(s)) {
    return '';
  }
  if (JUNK_HINT.test(s) || PRODUCT_NAME.test(s) || VERB_FIRST.test(s.split(/\s+/)[0] || '')) return '';
  if (ORG_TOKEN.test(s)) return s;
  const core = clipped.filter((w) => !/^(and|&|of|the|for)$/i.test(w));
  if (core.length === 2 && /^[A-Z]{2,8}$/.test(core[0]) && /^[A-Z]/.test(core[1])) return s;
  if (core.length >= 3 && core.length <= 6 && core.every((w) => /^[A-Z]/.test(w))) return s;
  return '';
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&eacute;/gi, 'é')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&acirc;|&cent;|&frac1[24];|&brvbar;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

export function buyerFacingText(text) {
  const s = decodeEntities(text);
  const cut = s.split(/列表页无邮箱|入库后补|列表标记有附件|列表有公开缩略图|正文写到公司/)[0];
  const body = cut.includes('。') ? cut.slice(cut.indexOf('。') + 1) : cut;
  return body.replace(/\s+/g, ' ').trim();
}

function attributedHint(src) {
  const legal = src.match(HINT_RE);
  if (legal) {
    const name = cleanHintName(legal[1]);
    const first = name.split(/\s+/)[0] || '';
    if (name.length >= 5 && name.length <= 80 && !JUNK_HINT.test(name) && !VERB_FIRST.test(first)
      && new RegExp(`\\b${LEGAL_SUFFIX}\\b`, 'i').test(name)) {
      return name;
    }
  }
  const named = src.match(NAMED_ORG_RE);
  if (named) return looksLikeNamedOrg(named[1]);
  return '';
}

function bareLegalHints(src) {
  const out = [];
  BARE_LEGAL_RE.lastIndex = 0;
  let m;
  while ((m = BARE_LEGAL_RE.exec(src))) {
    const name = cleanHintName(m[1]);
    if (name.length < 5 || name.length > 80) continue;
    if (JUNK_HINT.test(name) || PRODUCT_NAME.test(name) || VERB_FIRST.test(name.split(/\s+/)[0] || '')) continue;
    if (!new RegExp(`\\b${LEGAL_SUFFIX}\\b`, 'i').test(name)) continue;
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (!AFTER_NAME_OK.test(after)) continue;
    const before = src.slice(Math.max(0, m.index - 28), m.index).toLowerCase();
    if (/\b(looking for|seeking|purchase|buy|screens?|compatible model)\b/.test(before)) continue;
    out.push(name);
  }
  return out;
}

const FROM_ORG_RE = /\b(?:i am writing from|we are writing from|writing from)\s+([A-Z][A-Za-z0-9&.'-]{2,40})\b/;
const PAREN_BRAND_RE = /\(([A-Z][A-Za-z0-9&.' -]{2,40})\)/;
const OWNER_BRAND_RE = /\bowner of (?:a |an )?([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,4})\b/;

function casualOrgHint(src) {
  const from = src.match(FROM_ORG_RE);
  if (from) {
    const name = cleanHintName(from[1]);
    if (name.length >= 5 && !/^(India|China|Germany|France|England|America|Europe|Alibaba)$/i.test(name)) {
      return looksLikeNamedOrg(name) || (/^[A-Z][A-Za-z0-9&.'-]{4,40}$/.test(name) ? name : '');
    }
  }
  const owner = src.match(OWNER_BRAND_RE);
  if (owner) {
    const named = looksLikeNamedOrg(owner[1]);
    if (named) return named;
  }
  const paren = src.match(PAREN_BRAND_RE);
  if (paren) {
    const named = looksLikeNamedOrg(paren[1]);
    if (named) return named;
  }
  return '';
}

export function unsquashBuyerName(name) {
  let s = String(name || '').replace(/[_./]+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/ecommerceprivatelimited/ig, 'Ecommerce Private Limited');
  s = s.replace(/privatelimited/ig, ' Private Limited');
  s = s.replace(/pvt\.?\s*ltd/ig, ' Pvt Ltd');
  s = s.replace(/architecturallighting/ig, 'Architectural Lighting');
  s = s.replace(/engineeringsolutions/ig, 'Engineering Solutions');
  s = s.replace(/engineeringservices/ig, 'Engineering Services');
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return s.replace(/\s+/g, ' ').trim();
}

/** 显示名其实是粘在一起的公司名，不是 Linda。不拿来猜邮箱。 */
export function companyFromBuyerName(name) {
  const raw = String(name || '').trim();
  if (!raw || /alibaba buyer/i.test(raw)) return '';
  const unsquashed = unsquashBuyerName(raw);
  const words = unsquashed.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 10) return '';
  const hasLegal = new RegExp(`\\b${LEGAL_SUFFIX}\\b`, 'i').test(unsquashed);
  const german = words.some((w) => GERMAN_ORG.test(w));
  const orgHits = words.filter((w) => ORG_WORD.has(w.toLowerCase()));
  const camelGrew = unsquashed !== raw && words.length >= 3;
  if (!hasLegal && !german && !(camelGrew && orgHits.length) && !(words.length >= 3 && orgHits.length)) {
    return '';
  }
  const named = looksLikeNamedOrg(unsquashed);
  if (named) return named;
  if (hasLegal || german) return cleanHintName(unsquashed);
  if (orgHits.length && words.length >= 3 && words.length <= 8) return cleanHintName(unsquashed);
  return '';
}

export function extractCompanyHintFromText(text) {
  const src = buyerFacingText(text);
  if (!src) return '';
  return attributedHint(src) || bareLegalHints(src)[0] || casualOrgHint(src) || '';
}

/** 公开列表是 140px 货图。去掉尺寸后缀给人眼看/以图搜图，不下载登录墙附件。 */
export function largerPublicImage(imageUrl) {
  const raw = String(imageUrl || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/_(\d{2,4}x\d{2,4})\.(jpe?g|png|webp|gif)(\?.*)?$/i, '$3');
}

export function isAlibabaLoginRedirect(location) {
  return /passport\.alibaba\.com|login\.alibaba\.com|login_check\.htm/i.test(String(location || ''));
}

export function imageSearchLinks(imageUrl) {
  const raw = String(imageUrl || '').trim();
  if (!/^https?:\/\//i.test(raw)) return [];
  if (/alicdn\.com|alibaba\.com|aliimg\.com/i.test(raw) === false && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(raw)) {
    return [];
  }
  const target = largerPublicImage(raw) || raw;
  const enc = encodeURIComponent(target);
  return [
    { key: 'google-image', label: 'Google 以图搜图', url: `https://www.google.com/searchbyimage?image_url=${enc}` },
    { key: 'lens', label: 'Google Lens', url: `https://lens.google.com/uploadbyurl?url=${enc}` },
    { key: 'tineye', label: 'TinEye', url: `https://tineye.com/search?url=${enc}` },
    { key: 'bing-visual', label: 'Bing 视觉', url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${enc}` },
    { key: 'yandex-image', label: 'Yandex 以图搜图', url: `https://yandex.com/images/search?rpt=imageview&url=${enc}` },
  ];
}
