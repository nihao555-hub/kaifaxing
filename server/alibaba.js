import crypto from 'node:crypto';
import { config } from './config.js';

// 阿里国际站官方 TOP 协议：https://eco.taobao.com/router/rest
// 只走 alibaba.icbu.rfq.search，不爬页面、不扒买家邮箱。

export function alibabaReady() {
  const { appKey, appSecret, session } = config.alibaba;
  return Boolean(appKey && appSecret && session);
}

export function beijingTimestamp(date = new Date()) {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
}

export function topSign(params, secret, signMethod = 'hmac') {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] != null && params[k] !== '')
    .sort();
  const concat = keys.map((k) => `${k}${params[k]}`).join('');
  if (signMethod === 'md5') {
    return crypto.createHash('md5').update(secret + concat + secret, 'utf8').digest('hex').toUpperCase();
  }
  return crypto.createHmac('md5', secret).update(concat, 'utf8').digest('hex').toUpperCase();
}

export async function topCall(method, biz = {}, timeoutMs = 18000) {
  const { appKey, appSecret, session, gateway } = config.alibaba;
  if (!appKey || !appSecret || !session) {
    throw new Error('未配置阿里国际站开放平台：需要 ALIBABA_APP_KEY / ALIBABA_APP_SECRET / ALIBABA_SESSION');
  }
  const params = {
    method,
    app_key: appKey,
    session,
    timestamp: beijingTimestamp(),
    format: 'json',
    v: '2.0',
    sign_method: 'hmac',
    ...biz,
  };
  if (process.env.ALIBABA_MD5_KEY) params.md5key = process.env.ALIBABA_MD5_KEY;
  params.sign = topSign(params, appSecret, 'hmac');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params),
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (data.error_response) {
      const e = data.error_response;
      throw new Error(e.sub_msg || e.msg || `阿里开放平台错误 ${e.code || ''}`.trim());
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') {
    const nested = value.open_rfq_d_t_o || value.open_rfq_dto || value.rfq || value.item;
    if (nested) return asList(nested);
    return Object.values(value).filter((v) => v && typeof v === 'object');
  }
  return [];
}

export function extractRfqList(data) {
  const root = data?.alibaba_icbu_rfq_search_response || data?.alibaba_icbu_rfq_search_response_result || data;
  const result = root?.result || root;
  return asList(
    result?.rfq_list
    || result?.result_list
    || result?.rfqs
    || result?.open_rfq_d_t_o
  );
}

function pick(row, ...keys) {
  for (const k of keys) {
    if (row?.[k] != null && row[k] !== '') return row[k];
  }
  return '';
}

export function normalizeAlibabaRfq(row) {
  const id = pick(row, 'rfq_id', 'rfqId', 'id', 'open_rfq_id');
  const title = pick(row, 'subject', 'title', 'rfq_title', 'product_name');
  // 文档未保证这些字段；有就用，没有就仍是询盘标题/显示名。
  const company = pick(row, 'buyer_company_name', 'company_name', 'buyer_name', 'company');
  const country = pick(row, 'buyer_country', 'country', 'country_name');
  const qty = pick(row, 'quantity', 'quantity_desc', 'total_quantity');
  const category = pick(row, 'category_name', 'category', 'industry');
  const expire = pick(row, 'expire_time', 'expire_date', 'left_count', 'open_time');
  return {
    id: id ? `ali_${id}` : `ali_${crypto.createHash('md5').update(JSON.stringify(row)).digest('hex').slice(0, 10)}`,
    source: '阿里国际站 RFQ',
    sourceType: 'alibaba_icbu_rfq',
    kind: 'commercial',
    title,
    company: company || title || 'Alibaba buyer',
    name: company || 'Alibaba buyer',
    titleRole: 'Buyer',
    email: pick(row, 'email', 'buyer_email', 'contact_email'),
    country,
    timezone: '',
    industry: category || 'B2B RFQ',
    url: id ? `https://rfq.alibaba.com/rfq/detail.htm?rfqId=${id}` : 'https://rfq.alibaba.com',
    awardId: String(id || ''),
    amount: Number(qty) || 0,
    painPoints: `阿里国际站公开 RFQ：${title || ''}${qty ? `，数量 ${qty}` : ''}${country ? `，买家国家 ${country}` : ''}${expire ? `，截止 ${expire}` : ''}。搜索接口通常不返回个人邮箱；优先在国际站后台报价，有公司采购邮箱再补录。`,
  };
}

export async function searchAlibaba({ keyword = 'power tools', limit = 10 } = {}) {
  const cond = JSON.stringify({
    search_text: keyword,
    page_size: Math.max(1, Math.min(20, Number(limit) || 10)),
  });
  const data = await topCall('alibaba.icbu.rfq.search', { cond });
  return extractRfqList(data).map(normalizeAlibabaRfq);
}
