// 公开企业背调。只查公司主体和官网，不扒私人邮箱。
// 对齐 GitHub 上专门做客户尽调的工具用的公开接口：
//   StephenAbbott/opencheck（GLEIF → 各国开放登记）
//   ror-community/ror-api（科研/教育/医院机构库）
// 不接入 theHarvester / Sherlock / holehe（那些是扒私人账号，不是背调）。

function tokensOf(name) {
  return String(name || '')
    .toLowerCase()
    .split(/[^a-z0-9äöüßéèêàçøåæ]+/i)
    .filter((t) => t.length >= 3);
}

export function pickOpenHit(rows, company, getLabel) {
  const tokens = tokensOf(company);
  const first = tokens[0] || '';
  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const label = getLabel(row);
    const hay = String(label || '').toLowerCase();
    if (!hay) continue;
    if (first.length >= 4 && !hay.includes(first)) continue;
    const hit = tokens.filter((t) => hay.includes(t)).length;
    const cov = tokens.length ? hit / tokens.length : 0;
    if (cov >= 0.75 && cov > bestScore) {
      best = row;
      bestScore = cov;
    }
  }
  return best;
}

const UA = 'OutreachAI/1.0 (public due-diligence; +https://github.com/nihao555-hub/kaifaxing)';

async function getJson(url, extraHeaders = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', ...extraHeaders },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function withScheme(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, '')}`;
}

function hayOf(country, jurisdiction) {
  return `${country || ''} ${jurisdiction || ''}`.toLowerCase();
}

export function countryIs(country, jurisdiction, keys) {
  const hay = hayOf(country, jurisdiction);
  return keys.some((k) => hay.includes(String(k).toLowerCase()));
}

export function parseSireneHit(row) {
  if (!row) return null;
  const siege = row.siege || {};
  const address = [siege.adresse, siege.code_postal, siege.libelle_commune].filter(Boolean).join(', ');
  return {
    name: row.nom_complet || row.nom_raison_sociale || '',
    siren: row.siren || '',
    address,
    employees: row.tranche_effectif_salarie || row.annee_effectif || '',
    activity: row.libelle_activite_principale || row.activite_principale || '',
  };
}

export function parseBrregHit(row) {
  if (!row) return null;
  const addr = row.forretningsadresse || row.postadresse || {};
  const address = [...(addr.adresse || []), addr.postnummer, addr.poststed, addr.land].filter(Boolean).join(', ');
  return {
    name: row.navn || '',
    orgnr: String(row.organisasjonsnummer || '').replace(/\s+/g, ''),
    address,
    website: withScheme(row.hjemmeside || ''),
    employees: row.antallAnsatte != null ? String(row.antallAnsatte) : '',
    activity: row.naeringskode1?.beskrivelse || '',
    phone: row.telefon || '',
  };
}

export function parseRorHit(item) {
  if (!item) return null;
  const names = item.names || [];
  const display = names.find((n) => (n.types || []).includes('ror_display')) || names[0];
  const links = item.links || [];
  let website = '';
  if (Array.isArray(links) && links[0] && typeof links[0] === 'object') {
    website = (links.find((l) => l.type === 'website') || links[0]).value || '';
  } else if (Array.isArray(links) && typeof links[0] === 'string') {
    website = links[0];
  }
  const loc = item.locations?.[0]?.geonames_details || {};
  return {
    name: display?.value || item.name || '',
    ror: String(item.id || '').replace('https://ror.org/', ''),
    website: withScheme(website),
    country: loc.country_name || item.country?.country_name || '',
    types: (item.types || []).join(', '),
  };
}

export async function searchSirene(company) {
  const q = String(company || '').trim();
  if (q.length < 4) return null;
  const data = await getJson(
    `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&page=1&per_page=5`
  );
  const rows = data?.results || [];
  const picked = pickOpenHit(rows, company, (h) => h.nom_complet || h.nom_raison_sociale || '');
  return picked ? parseSireneHit(picked) : null;
}

export async function fetchSireneBySiren(siren) {
  const id = String(siren || '').replace(/\D/g, '');
  if (id.length !== 9) return null;
  const data = await getJson(`https://recherche-entreprises.api.gouv.fr/search?q=${id}&page=1&per_page=1`);
  return parseSireneHit(data?.results?.[0]);
}

export async function searchBrreg(company) {
  const q = String(company || '').trim();
  if (q.length < 3) return null;
  const data = await getJson(
    `https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(q)}&size=5`
  );
  const rows = data?._embedded?.enheter || [];
  const picked = pickOpenHit(rows, company, (h) => h.navn || '');
  return picked ? parseBrregHit(picked) : null;
}

export async function fetchBrregByOrgnr(orgnr) {
  const id = String(orgnr || '').replace(/\D/g, '');
  if (id.length < 8) return null;
  const data = await getJson(`https://data.brreg.no/enhetsregisteret/api/enheter/${id}`);
  return parseBrregHit(data);
}

export async function fetchPrhById(businessId) {
  const id = String(businessId || '').trim();
  if (!/^\d{6,8}-\d$/.test(id)) return null;
  const data = await getJson(
    `https://avoindata.prh.fi/opendata-ytj-api/v3/companies?businessId=${encodeURIComponent(id)}`
  );
  const row = data?.companies?.[0];
  if (!row) return null;
  const name = row.names?.find((n) => !n.endDate)?.name || row.names?.[0]?.name || '';
  const addr = row.addresses?.[0] || {};
  return {
    name,
    businessId: row.businessId?.value || id,
    address: [addr.street, addr.postCode, addr.city, addr.country].filter(Boolean).join(', '),
    website: withScheme(row.website || row.contactDetails?.find((c) => /www|web/i.test(c.type || ''))?.value || ''),
  };
}

export async function fetchAresByIco(ico) {
  const id = String(ico || '').replace(/\D/g, '');
  if (id.length !== 8) return null;
  const data = await getJson(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${id}`);
  if (!data?.ico && !data?.obchodniJmeno) return null;
  const sidlo = data.sidlo || {};
  return {
    name: data.obchodniJmeno || '',
    ico: data.ico || id,
    address: [sidlo.textovaAdresa, sidlo.nazevObce, sidlo.nazevStatu].filter(Boolean).join(', '),
    activity: data.czNace?.[0] || '',
  };
}

export async function fetchCnpj(cnpj) {
  const id = String(cnpj || '').replace(/\D/g, '');
  if (id.length !== 14) return null;
  const data = await getJson(`https://brasilapi.com.br/api/cnpj/v1/${id}`);
  if (!data?.cnpj && !data?.razao_social) return null;
  return {
    name: data.razao_social || data.nome_fantasia || '',
    cnpj: data.cnpj || id,
    address: [data.logradouro, data.numero, data.municipio, data.uf].filter(Boolean).join(', '),
    activity: data.cnae_fiscal_descricao || '',
    status: data.descricao_situacao_cadastral || '',
  };
}

export async function searchRor(company) {
  const q = String(company || '').trim();
  if (q.length < 5) return null;
  const data = await getJson(`https://api.ror.org/organizations?query=${encodeURIComponent(q)}`);
  const rows = data?.items || [];
  const picked = pickOpenHit(rows, company, (h) => parseRorHit(h)?.name || '');
  return picked ? parseRorHit(picked) : null;
}

export async function suggestClearbit(company) {
  const q = String(company || '').trim();
  if (q.length < 4) return null;
  const rows = await getJson(
    `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`
  );
  if (!Array.isArray(rows) || !rows.length) return null;
  const picked = pickOpenHit(rows, company, (h) => h.name || '');
  if (!picked?.domain) return null;
  return { name: picked.name || '', website: withScheme(picked.domain) };
}

const COUNTRY_EN = {
  英国: 'United Kingdom', 美国: 'United States', 法国: 'France', 德国: 'Germany',
  荷兰: 'Netherlands', 挪威: 'Norway', 芬兰: 'Finland', 印度: 'India',
  中国: 'China', 日本: 'Japan', 韩国: 'South Korea', 澳大利亚: 'Australia',
  加拿大: 'Canada', 巴西: 'Brazil', 意大利: 'Italy', 西班牙: 'Spain',
  波兰: 'Poland', 捷克: 'Czechia', 瑞典: 'Sweden', 丹麦: 'Denmark',
};

export async function searchNominatim(company, country = '') {
  const q = [company, COUNTRY_EN[country] || country].filter(Boolean).join(', ');
  if (String(company || '').trim().length < 5) return null;
  const data = await getJson(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&extratags=1&limit=5`,
    { 'Accept-Language': 'en' }
  );
  if (!Array.isArray(data) || !data.length) return null;
  const picked = pickOpenHit(data, company, (h) => `${h.name || ''} ${h.extratags?.operator || ''}`);
  if (!picked) return null;
  const extra = picked.extratags || {};
  return {
    name: picked.name || picked.display_name || '',
    website: withScheme(extra.website || ''),
    phone: extra.phone || extra['operator:phone'] || '',
    address: picked.display_name || '',
    wikidata: extra.wikidata || '',
  };
}

export async function gleifParent(lei, kind = 'ultimate-parent') {
  const code = String(lei || '').trim();
  if (!/^[A-Z0-9]{20}$/i.test(code)) return null;
  const data = await getJson(`https://api.gleif.org/api/v1/lei-records/${code}/${kind}`);
  const rec = data?.data;
  if (!rec) return null;
  const ent = rec.attributes?.entity || {};
  return {
    lei: rec.id || rec.attributes?.lei || '',
    name: ent.legalName?.name || '',
    status: ent.status || '',
  };
}

export async function rdapDomain(website) {
  try {
    const host = new URL(withScheme(website)).hostname.replace(/^www\./, '');
    if (!host || host.split('.').length < 2) return null;
    const data = await getJson(`https://rdap.org/domain/${host}`);
    if (!data) return null;
    const events = data.events || [];
    const created = events.find((e) => e.eventAction === 'registration')?.eventDate || '';
    const registrar = data.entities?.find((e) => (e.roles || []).includes('registrar'))?.vcardArray?.[1]
      ?.find((v) => v[0] === 'fn')?.[3] || '';
    return { host, created: String(created).slice(0, 10), registrar };
  } catch {
    return null;
  }
}

const RA_KIND = {
  RA000472: 'brreg',
  RA000168: 'sirene',
  RA000053: 'sirene',
  RA000188: 'prh',
  RA000163: 'ares',
  RA000681: 'cnpj',
  RA000585: 'ch',
  RA000196: 'ch',
  RA000791: 'ch',
};

export function shouldQuerySirene(country, jurisdiction) {
  return countryIs(country, jurisdiction, ['france', '法国', 'fr']);
}

export function shouldQueryBrreg(country, jurisdiction) {
  return countryIs(country, jurisdiction, ['norway', '挪威', 'norge', 'no']);
}

export function shouldQueryPrh(country, jurisdiction) {
  return countryIs(country, jurisdiction, ['finland', '芬兰', 'suomi', 'fi']);
}

export function shouldQueryAres(country, jurisdiction) {
  return countryIs(country, jurisdiction, ['czech', 'czechia', '捷克', 'cz']);
}

export async function searchPrh(company) {
  const q = String(company || '').trim();
  if (q.length < 4) return null;
  const data = await getJson(
    `https://avoindata.prh.fi/opendata-ytj-api/v3/companies?name=${encodeURIComponent(q)}&maxResults=8`
  );
  const rows = data?.companies || [];
  const picked = pickOpenHit(rows, company, (h) => {
    const live = (h.names || []).find((n) => !n.endDate)?.name || (h.names || [])[0]?.name || '';
    return live;
  });
  if (!picked) return null;
  return fetchPrhById(picked.businessId?.value || '');
}

export async function searchAres(company) {
  const q = String(company || '').trim();
  if (q.length < 4) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch('https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat', {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ obchodniJmeno: q, start: 0, pocet: 5 }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = data?.ekonomickeSubjekty || [];
    const picked = pickOpenHit(rows, company, (h) => h.obchodniJmeno || '');
    return picked ? fetchAresByIco(picked.ico) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function factVal(facts, labelRe) {
  return facts.find((f) => labelRe.test(f.label))?.value || '';
}

function pushFact(extra, sources, item) {
  if (!item?.value) return;
  extra.push(item);
}

function companyHouseUrl(number) {
  const id = String(number || '').replace(/\s+/g, '');
  if (!id) return '';
  return `https://find-and-update.company-information.service.gov.uk/company/${id}`;
}

async function lookupByRegistration(facts) {
  const ra = String(factVal(facts, /登记机关|RA code/i) || '').toUpperCase();
  const raw = factVal(facts, /登记号|注册号|registeredAs/i);
  const jurisdiction = factVal(facts, /法域/);
  let kind = RA_KIND[ra] || '';
  const compact = String(raw || '').replace(/\s+/g, '');
  if (!kind && /^(GB|UK)/i.test(jurisdiction) && /^\d{6,8}$/.test(compact)) kind = 'ch';
  if (!kind || !raw) return { facts: [], sources: [], website: '' };
  const extra = [];
  const sources = [];
  let website = '';

  if (kind === 'brreg') {
    const hit = await fetchBrregByOrgnr(raw);
    if (hit?.name) {
      extra.push({ label: '挪威企业登记', value: `${hit.name} · Org.nr ${hit.orgnr}`, source: 'Brreg' });
      if (hit.address) extra.push({ label: '注册地址', value: hit.address, source: 'Brreg' });
      if (hit.activity) extra.push({ label: '行业', value: hit.activity, source: 'Brreg' });
      if (hit.employees) extra.push({ label: '员工规模', value: hit.employees, source: 'Brreg' });
      if (hit.phone) extra.push({ label: '公开电话', value: hit.phone, source: 'Brreg' });
      website = hit.website;
      sources.push({ title: `Brreg ${hit.orgnr}`, url: `https://data.brreg.no/enhetsregisteret/oppslag/enheter/${hit.orgnr}` });
    }
  } else if (kind === 'sirene') {
    const hit = await fetchSireneBySiren(raw);
    if (hit?.name) {
      extra.push({ label: '法国企业登记', value: `${hit.name} · SIREN ${hit.siren}`, source: 'Sirene' });
      if (hit.address) extra.push({ label: '注册地址', value: hit.address, source: 'Sirene' });
      if (hit.activity) extra.push({ label: '行业', value: hit.activity, source: 'Sirene' });
      sources.push({ title: `Sirene ${hit.siren}`, url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${hit.siren}` });
    }
  } else if (kind === 'prh') {
    const hit = await fetchPrhById(raw);
    if (hit?.name) {
      extra.push({ label: '芬兰企业登记', value: `${hit.name} · ${hit.businessId}`, source: 'PRH' });
      if (hit.address) extra.push({ label: '注册地址', value: hit.address, source: 'PRH' });
      website = hit.website;
      sources.push({ title: `PRH ${hit.businessId}`, url: `https://www.kauppalehti.fi/yritykset/yritys/${hit.businessId}` });
    }
  } else if (kind === 'ares') {
    const hit = await fetchAresByIco(raw);
    if (hit?.name) {
      extra.push({ label: '捷克企业登记', value: `${hit.name} · IČO ${hit.ico}`, source: 'ARES' });
      if (hit.address) extra.push({ label: '注册地址', value: hit.address, source: 'ARES' });
      sources.push({ title: `ARES ${hit.ico}`, url: `https://ares.gov.cz/ekonomicke-subjekty?ico=${hit.ico}` });
    }
  } else if (kind === 'cnpj') {
    const hit = await fetchCnpj(raw);
    if (hit?.name) {
      extra.push({ label: '巴西企业登记', value: `${hit.name} · CNPJ ${hit.cnpj}`, source: 'Receita' });
      if (hit.address) extra.push({ label: '注册地址', value: hit.address, source: 'Receita' });
      if (hit.activity) extra.push({ label: '行业', value: hit.activity, source: 'Receita' });
      sources.push({ title: `CNPJ ${hit.cnpj}`, url: `https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp` });
    }
  } else if (kind === 'ch') {
    const url = companyHouseUrl(raw);
    if (url) {
      extra.push({ label: '英国公司登记号', value: String(raw).replace(/\s+/g, ''), source: 'Companies House' });
      sources.push({ title: `Companies House ${raw}`, url });
    }
  }
  return { facts: extra, sources, website };
}

export const VERIFIED_SOURCES = new Set([
  'GLEIF', 'Wikidata', 'Sirene', 'ROR', 'Brreg', 'PRH', 'ARES', 'Receita', 'Companies House',
]);

export async function enrichOpenSources({ company, country, facts = [], website = '' } = {}) {
  const extra = [];
  const sources = [];
  let site = website;
  const lei = factVal(facts, /^LEI$/);
  const jurisdiction = factVal(facts, /法域/);

  const jobs = [];
  jobs.push((async () => {
    if (!lei) return;
    const parent = await gleifParent(lei, 'ultimate-parent') || await gleifParent(lei, 'direct-parent');
    if (parent?.name) {
      pushFact(extra, sources, { label: '最终母公司', value: `${parent.name}${parent.lei ? ` (${parent.lei})` : ''}`, source: 'GLEIF' });
      sources.push({ title: `GLEIF parent ${parent.lei}`, url: `https://search.gleif.org/#/record/${parent.lei}` });
    }
  })());

  jobs.push((async () => {
    const byId = await lookupByRegistration(facts);
    extra.push(...byId.facts);
    sources.push(...byId.sources);
    if (!site && byId.website) site = byId.website;
  })());

  jobs.push((async () => {
    if (!shouldQuerySirene(country, jurisdiction) || tokensOf(company).length < 2) return;
    if (factVal(facts, /法国企业登记/)) return;
    const fr = await searchSirene(company);
    if (!fr?.name) return;
    extra.push({ label: '法国企业登记', value: `${fr.name}${fr.siren ? ` · SIREN ${fr.siren}` : ''}`, source: 'Sirene' });
    if (fr.address) extra.push({ label: '注册地址', value: fr.address, source: 'Sirene' });
    if (fr.activity) extra.push({ label: '行业', value: fr.activity, source: 'Sirene' });
    if (fr.employees) extra.push({ label: '员工规模', value: String(fr.employees), source: 'Sirene' });
    if (fr.siren) sources.push({ title: `Sirene ${fr.siren}`, url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${fr.siren}` });
  })());

  jobs.push((async () => {
    if (!shouldQueryBrreg(country, jurisdiction) || tokensOf(company).length < 2) return;
    if (factVal(facts, /挪威企业登记/)) return;
    const no = await searchBrreg(company);
    if (!no?.name) return;
    extra.push({ label: '挪威企业登记', value: `${no.name}${no.orgnr ? ` · Org.nr ${no.orgnr}` : ''}`, source: 'Brreg' });
    if (no.address) extra.push({ label: '注册地址', value: no.address, source: 'Brreg' });
    if (no.activity) extra.push({ label: '行业', value: no.activity, source: 'Brreg' });
    if (no.employees) extra.push({ label: '员工规模', value: no.employees, source: 'Brreg' });
    if (no.phone) extra.push({ label: '公开电话', value: no.phone, source: 'Brreg' });
    if (!site && no.website) site = no.website;
    if (no.orgnr) sources.push({ title: `Brreg ${no.orgnr}`, url: `https://data.brreg.no/enhetsregisteret/oppslag/enheter/${no.orgnr}` });
  })());

  jobs.push((async () => {
    if (!shouldQueryPrh(country, jurisdiction) || tokensOf(company).length < 2) return;
    if (factVal(facts, /芬兰企业登记/)) return;
    const fi = await searchPrh(company);
    if (!fi?.name) return;
    extra.push({ label: '芬兰企业登记', value: `${fi.name}${fi.businessId ? ` · ${fi.businessId}` : ''}`, source: 'PRH' });
    if (fi.address) extra.push({ label: '注册地址', value: fi.address, source: 'PRH' });
    if (!site && fi.website) site = fi.website;
    if (fi.businessId) sources.push({ title: `PRH ${fi.businessId}`, url: `https://www.kauppalehti.fi/yritykset/yritys/${fi.businessId}` });
  })());

  jobs.push((async () => {
    if (!shouldQueryAres(country, jurisdiction) || tokensOf(company).length < 2) return;
    if (factVal(facts, /捷克企业登记/)) return;
    const cz = await searchAres(company);
    if (!cz?.name) return;
    extra.push({ label: '捷克企业登记', value: `${cz.name}${cz.ico ? ` · IČO ${cz.ico}` : ''}`, source: 'ARES' });
    if (cz.address) extra.push({ label: '注册地址', value: cz.address, source: 'ARES' });
    if (cz.ico) sources.push({ title: `ARES ${cz.ico}`, url: `https://ares.gov.cz/ekonomicke-subjekty?ico=${cz.ico}` });
  })());

  jobs.push((async () => {
    const ror = await searchRor(company);
    if (!ror?.name) return;
    extra.push({ label: 'ROR 机构库', value: `${ror.name}${ror.ror ? ` (${ror.ror})` : ''}`, source: 'ROR' });
    if (ror.types) extra.push({ label: '机构类型', value: ror.types, source: 'ROR' });
    if (!site && ror.website) site = ror.website;
    if (ror.ror) sources.push({ title: `ROR ${ror.ror}`, url: `https://ror.org/${ror.ror}` });
  })());

  jobs.push((async () => {
    if (site) return;
    const cb = await suggestClearbit(company);
    if (!cb?.website) return;
    extra.push({ label: '公开域名提示', value: cb.website, source: 'Clearbit' });
    site = cb.website;
    sources.push({ title: cb.name || cb.website, url: cb.website });
  })());

  jobs.push((async () => {
    const osm = await searchNominatim(company, country);
    if (!osm) return;
    if (osm.address) extra.push({ label: '公开地址', value: osm.address, source: 'OSM' });
    if (osm.phone) extra.push({ label: '公开电话', value: osm.phone, source: 'OSM' });
    if (!site && osm.website) site = osm.website;
    if (osm.website) sources.push({ title: 'OpenStreetMap', url: osm.website });
  })());

  await Promise.all(jobs);

  if (site) {
    const rdap = await rdapDomain(site);
    if (rdap?.host) {
      extra.push({
        label: '域名登记',
        value: [rdap.host, rdap.created && `注册于 ${rdap.created}`, rdap.registrar].filter(Boolean).join(' · '),
        source: 'RDAP',
      });
    }
  }

  return { facts: extra.filter((f) => f.value), sources, website: site || '' };
}
