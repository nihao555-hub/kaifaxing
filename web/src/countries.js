const ISO2 = {
  afghanistan: 'af', albania: 'al', algeria: 'dz', angola: 'ao', anguilla: 'ai',
  'antigua and barbuda': 'ag', argentina: 'ar', armenia: 'am', australia: 'au',
  austria: 'at', azerbaijan: 'az', bahamas: 'bs', bahrain: 'bh', bangladesh: 'bd',
  belarus: 'by', belgium: 'be', belize: 'bz', benin: 'bj', bhutan: 'bt',
  bolivia: 'bo', 'bosnia and herzegovina': 'ba', botswana: 'bw', brazil: 'br',
  bulgaria: 'bg', 'burkina faso': 'bf', cambodia: 'kh', cameroon: 'cm',
  canada: 'ca', 'cape verde': 'cv', 'cayman islands': 'ky',
  'central african republic': 'cf', chad: 'td', chile: 'cl', china: 'cn',
  colombia: 'co', comoros: 'km', 'costa rica': 'cr', "cote d'ivoire": 'ci',
  "cote divoire": 'ci', curacao: 'cw', cyprus: 'cy', 'czech republic': 'cz',
  czechia: 'cz', denmark: 'dk', 'dominican republic': 'do', ecuador: 'ec',
  egypt: 'eg', 'el salvador': 'sv', estonia: 'ee', ethiopia: 'et', fiji: 'fj',
  finland: 'fi', france: 'fr', 'french guiana': 'gf', 'french polynesia': 'pf',
  gabon: 'ga', georgia: 'ge', germany: 'de', ghana: 'gh', greece: 'gr',
  guatemala: 'gt', guinea: 'gn', guyana: 'gy', haiti: 'ht', honduras: 'hn',
  'hong kong': 'hk', 'hong kong s.a.r.': 'hk', 'hong kong sar': 'hk',
  hungary: 'hu', iceland: 'is', india: 'in', indonesia: 'id', iraq: 'iq',
  ireland: 'ie', israel: 'il', italy: 'it', jamaica: 'jm', japan: 'jp',
  jordan: 'jo', kazakhstan: 'kz', kenya: 'ke', kuwait: 'kw', kyrgyzstan: 'kg',
  latvia: 'lv', lebanon: 'lb', liberia: 'lr', libya: 'ly', lithuania: 'lt',
  luxembourg: 'lu', madagascar: 'mg', malawi: 'mw', malaysia: 'my', mali: 'ml',
  malta: 'mt', 'marshall islands': 'mh', martinique: 'mq', mauritania: 'mr',
  mauritius: 'mu', mayotte: 'yt', mexico: 'mx', moldova: 'md', mongolia: 'mn',
  morocco: 'ma', mozambique: 'mz', myanmar: 'mm', namibia: 'na', nepal: 'np',
  netherlands: 'nl', 'new caledonia': 'nc', 'new zealand': 'nz', nicaragua: 'ni',
  niger: 'ne', nigeria: 'ng', norway: 'no', oman: 'om', pakistan: 'pk',
  palestine: 'ps', panama: 'pa', 'papua new guinea': 'pg', paraguay: 'py',
  peru: 'pe', philippines: 'ph', poland: 'pl', portugal: 'pt', 'puerto rico': 'pr',
  qatar: 'qa', reunion: 're', romania: 'ro', 'russian federation': 'ru', russia: 'ru',
  rwanda: 'rw', 'saint barthelemy': 'bl', 'saint kitts and nevis': 'kn', samoa: 'ws',
  'saudi arabia': 'sa', senegal: 'sn', serbia: 'rs', seychelles: 'sc',
  singapore: 'sg', slovakia: 'sk', 'slovakia (slovak republic)': 'sk',
  slovenia: 'si', 'solomon islands': 'sb', somalia: 'so',
  'somalia, federal republic of': 'so', 'south africa': 'za', 'south korea': 'kr',
  korea: 'kr', 'south sudan': 'ss', spain: 'es', 'sri lanka': 'lk', sudan: 'sd',
  suriname: 'sr', sweden: 'se', switzerland: 'ch', 'syrian arab republic': 'sy',
  syria: 'sy', tajikistan: 'tj', tanzania: 'tz', thailand: 'th', togo: 'tg',
  'trinidad and tobago': 'tt', tunisia: 'tn', turkey: 'tr', turkmenistan: 'tm',
  'turks and caicos islands': 'tc', uganda: 'ug', ukraine: 'ua',
  'united arab emirates': 'ae', uae: 'ae', 'united kingdom': 'gb', uk: 'gb',
  gb: 'gb', britain: 'gb', 'united states': 'us', usa: 'us', us: 'us',
  uruguay: 'uy', uzbekistan: 'uz', venezuela: 've', vietnam: 'vn', yemen: 'ye',
  zambia: 'zm', zimbabwe: 'zw',
  'congo, democratic republic of': 'cd', 'democratic republic of congo': 'cd',
  'congo, the democratic republic of the': 'cd', 'congo, republic of': 'cg',
  'congo, the republic of congo': 'cg', 'drc - angola': 'cd',
  美国: 'us', 英国: 'gb', 德国: 'de', 法国: 'fr', 荷兰: 'nl', 意大利: 'it',
  西班牙: 'es', 波兰: 'pl', 葡萄牙: 'pt', 爱尔兰: 'ie', 瑞典: 'se', 瑞士: 'ch',
  芬兰: 'fi', 丹麦: 'dk', 奥地利: 'at', 希腊: 'gr', 匈牙利: 'hu', 捷克: 'cz',
  罗马尼亚: 'ro', 中国: 'cn', 印度: 'in', 日本: 'jp', 韩国: 'kr', 澳大利亚: 'au',
  巴西: 'br', 加拿大: 'ca', 墨西哥: 'mx', 阿根廷: 'ar', 土耳其: 'tr',
  沙特阿拉伯: 'sa', 阿联酋: 'ae', 南非: 'za', 俄罗斯: 'ru', 印尼: 'id',
  越南: 'vn', 泰国: 'th', 马来西亚: 'my', 新加坡: 'sg', 菲律宾: 'ph',
  巴基斯坦: 'pk', 尼日利亚: 'ng', 埃及: 'eg', 以色列: 'il', 智利: 'cl',
  哥伦比亚: 'co', 秘鲁: 'pe', 新西兰: 'nz', 比利时: 'be', 挪威: 'no',
};

const ISO3 = {
  bgr: 'bg', est: 'ee', ltu: 'lt', lva: 'lv', mkd: 'mk', svk: 'sk', svn: 'si',
  usa: 'us', gbr: 'gb', deu: 'de', fra: 'fr', chn: 'cn', ind: 'in',
};

const ZH = {
  af: '阿富汗', al: '阿尔巴尼亚', dz: '阿尔及利亚', ao: '安哥拉', ai: '安圭拉',
  ag: '安提瓜和巴布达', ar: '阿根廷', am: '亚美尼亚', au: '澳大利亚', at: '奥地利',
  az: '阿塞拜疆', bs: '巴哈马', bh: '巴林', bd: '孟加拉', by: '白俄罗斯',
  be: '比利时', bz: '伯利兹', bj: '贝宁', bt: '不丹', bo: '玻利维亚',
  ba: '波黑', bw: '博茨瓦纳', br: '巴西', bg: '保加利亚', bf: '布基纳法索',
  kh: '柬埔寨', cm: '喀麦隆', ca: '加拿大', cv: '佛得角', ky: '开曼群岛',
  cf: '中非', td: '乍得', cl: '智利', cn: '中国', co: '哥伦比亚', km: '科摩罗',
  cr: '哥斯达黎加', ci: '科特迪瓦', cw: '库拉索', cy: '塞浦路斯', cz: '捷克',
  dk: '丹麦', do: '多米尼加', ec: '厄瓜多尔', eg: '埃及', sv: '萨尔瓦多',
  ee: '爱沙尼亚', et: '埃塞俄比亚', fj: '斐济', fi: '芬兰', fr: '法国',
  gf: '法属圭亚那', pf: '法属波利尼西亚', ga: '加蓬', ge: '格鲁吉亚', de: '德国',
  gh: '加纳', gr: '希腊', gt: '危地马拉', gn: '几内亚', gy: '圭亚那',
  ht: '海地', hn: '洪都拉斯', hk: '中国香港', hu: '匈牙利', is: '冰岛',
  in: '印度', id: '印度尼西亚', iq: '伊拉克', ie: '爱尔兰', il: '以色列',
  it: '意大利', jm: '牙买加', jp: '日本', jo: '约旦', kz: '哈萨克斯坦',
  ke: '肯尼亚', kw: '科威特', kg: '吉尔吉斯斯坦', lv: '拉脱维亚', lb: '黎巴嫩',
  lr: '利比里亚', ly: '利比亚', lt: '立陶宛', lu: '卢森堡', mg: '马达加斯加',
  mw: '马拉维', my: '马来西亚', ml: '马里', mt: '马耳他', mh: '马绍尔群岛',
  mq: '马提尼克', mr: '毛里塔尼亚', mu: '毛里求斯', yt: '马约特', mx: '墨西哥',
  md: '摩尔多瓦', mn: '蒙古', ma: '摩洛哥', mz: '莫桑比克', mm: '缅甸',
  na: '纳米比亚', np: '尼泊尔', nl: '荷兰', nc: '新喀里多尼亚', nz: '新西兰',
  ni: '尼加拉瓜', ne: '尼日尔', ng: '尼日利亚', no: '挪威', om: '阿曼',
  pk: '巴基斯坦', ps: '巴勒斯坦', pa: '巴拿马', pg: '巴布亚新几内亚',
  py: '巴拉圭', pe: '秘鲁', ph: '菲律宾', pl: '波兰', pt: '葡萄牙',
  pr: '波多黎各', qa: '卡塔尔', re: '留尼汪', ro: '罗马尼亚', ru: '俄罗斯',
  rw: '卢旺达', bl: '圣巴泰勒米', kn: '圣基茨和尼维斯', ws: '萨摩亚',
  sa: '沙特阿拉伯', sn: '塞内加尔', rs: '塞尔维亚', sc: '塞舌尔', sg: '新加坡',
  sk: '斯洛伐克', si: '斯洛文尼亚', sb: '所罗门群岛', so: '索马里',
  za: '南非', kr: '韩国', ss: '南苏丹', es: '西班牙', lk: '斯里兰卡',
  sd: '苏丹', sr: '苏里南', se: '瑞典', ch: '瑞士', sy: '叙利亚',
  tj: '塔吉克斯坦', tz: '坦桑尼亚', th: '泰国', tg: '多哥', tt: '特立尼达和多巴哥',
  tn: '突尼斯', tr: '土耳其', tm: '土库曼斯坦', tc: '特克斯和凯科斯',
  ug: '乌干达', ua: '乌克兰', ae: '阿联酋', gb: '英国', us: '美国',
  uy: '乌拉圭', uz: '乌兹别克斯坦', ve: '委内瑞拉', vn: '越南', ye: '也门',
  zm: '赞比亚', zw: '津巴布韦', cd: '刚果（金）', cg: '刚果（布）', mk: '北马其顿',
};

function norm(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[.’']/g, '')
    .replace(/\s+/g, ' ');
}

export function countryIso(name) {
  const raw = String(name || '').trim();
  if (!raw || raw === '未标注') return '';
  const key = norm(raw);
  if (ISO2[key]) return ISO2[key];
  if (ISO2[raw]) return ISO2[raw];
  if (/^[a-z]{2}$/i.test(raw) && ZH[raw.toLowerCase()]) return raw.toLowerCase();
  if (/^[a-z]{3}$/i.test(raw) && ISO3[key]) return ISO3[key];
  return '';
}

export function countryLabel(name) {
  const iso = countryIso(name);
  if (iso && ZH[iso]) return ZH[iso];
  const raw = String(name || '').trim();
  return raw && raw !== '未标注' ? raw : '未标注';
}

export function countrySearchText(name) {
  const iso = countryIso(name);
  return [name, countryLabel(name), iso, iso && ZH[iso]].filter(Boolean).join(' ').toLowerCase();
}

export function groupCountryFacets(countries = {}) {
  const groups = new Map();
  for (const [name, count] of Object.entries(countries)) {
    const iso = countryIso(name);
    const key = iso || `raw:${name}`;
    const cur = groups.get(key) || { key, iso, label: countryLabel(name), names: [], count: 0 };
    cur.names.push(name);
    cur.count += count;
    if (!cur.iso) cur.label = name;
    groups.set(key, cur);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
