/** 从公开询盘正文抽法定名；公开缩略图只给浏览器以图搜图链接，不爬登录墙、不扒私人邮箱。 */

const LEGAL_SUFFIX = String.raw`(?:L\.?L\.?C\.?|Ltd\.?|Limited|GmbH|Mbh|Inc\.?|PLC|Pte\.?\s*Ltd\.?|S\.?A\.?S?\.?|B\.?V\.?|N\.?V\.?|Pty\.?\s*Ltd\.?|Pvt\.?\s*Ltd\.?|SARL|SRL)`;

const ATTRIBUTION = String.raw`(?:our\s+company(?:\s+name)?\s+is|company\s+name\s*(?:is|:)|i\s+(?:work|am)\s+(?:at|for|with|from)|(?:we\s+are\s+)?representing|on\s+behalf\s+of|we\s+are(?!\s+(?:seeking|looking|interested|from|representing|considering|reaching|planning|hoping|trying|sourcing|procuring|a\s+(?:company|manufacturer|supplier|buyer|distributor))))`;

const JUNK_HINT = /\b(your|our|the|this|their|my|new|industrial)\s+company\b|\b(procuring|sourcing|considering|reaching|hardware|packaging|edition)\b/i;

const HINT_RE = new RegExp(
  `${ATTRIBUTION}\\s+([A-Z][A-Za-z0-9&.'\\-]+(?:\\s+[A-Z0-9][A-Za-z0-9&.'\\-]*){0,6}\\s+${LEGAL_SUFFIX})\\b`,
  'i',
);

export function buyerFacingText(text) {
  const s = String(text || '').replace(/<[^>]+>/g, ' ');
  const cut = s.split(/列表页无邮箱|入库后补|列表标记有附件|列表有公开缩略图|正文写到公司/)[0];
  const body = cut.includes('。') ? cut.slice(cut.indexOf('。') + 1) : cut;
  return body.replace(/\s+/g, ' ').trim();
}

export function extractCompanyHintFromText(text) {
  const src = buyerFacingText(text);
  if (!src) return '';
  const m = src.match(HINT_RE);
  if (!m) return '';
  const name = m[1].replace(/\s+/g, ' ').trim();
  if (name.length < 5 || name.length > 80) return '';
  if (JUNK_HINT.test(name)) return '';
  if (!new RegExp(`\\b${LEGAL_SUFFIX}\\b`, 'i').test(name)) return '';
  return name;
}

export function imageSearchLinks(imageUrl) {
  const raw = String(imageUrl || '').trim();
  if (!/^https?:\/\//i.test(raw)) return [];
  if (/alicdn\.com|alibaba\.com|aliimg\.com/i.test(raw) === false && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(raw)) {
    return [];
  }
  const enc = encodeURIComponent(raw);
  return [
    { key: 'google-image', label: 'Google 以图搜图', url: `https://www.google.com/searchbyimage?image_url=${enc}` },
    { key: 'lens', label: 'Google Lens', url: `https://lens.google.com/uploadbyurl?url=${enc}` },
    { key: 'tineye', label: 'TinEye', url: `https://tineye.com/search?url=${enc}` },
    { key: 'bing-visual', label: 'Bing 视觉', url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${enc}` },
  ];
}
