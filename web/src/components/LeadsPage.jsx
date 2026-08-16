import { useCallback, useEffect, useState } from 'react';
import {
  Search,
  ScanSearch,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Mail,
  Globe,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../api.js';
import { Avatar, Spinner } from './common.jsx';

const CONTACT_FILTERS = [
  { key: '', label: '全部' },
  { key: 'missing', label: '待补邮箱' },
  { key: 'researched', label: '已背调' },
  { key: 'found', label: '已有邮箱' },
];

const CONFIDENCE = {
  high: { label: '高', cls: 'bg-emerald-50 text-emerald-600' },
  medium: { label: '中', cls: 'bg-amber-50 text-amber-600' },
  low: { label: '低', cls: 'bg-slate-100 text-slate-500' },
  none: { label: '无', cls: 'bg-rose-50 text-rose-500' },
};

function Pill({ ok, children }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
      {children}
    </span>
  );
}

export default function LeadsPage() {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [contact, setContact] = useState('missing');
  const [quality, setQuality] = useState('company');
  const [page, setPage] = useState(0);
  const [limit] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({ sources: {}, total: 0, needEmail: 0, hasEmail: 0, researched: 0 });
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pickedEmail, setPickedEmail] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await api.rfqLeads({ q, source, contact, quality, limit, offset: page * limit });
      setRows(data.items || []);
      setTotal(data.total || 0);
      if (data.facets) setFacets(data.facets);
      setSelectedId((cur) => cur || data.items?.[0]?.id || null);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [q, source, contact, quality, limit, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    api.rfqLead(selectedId)
      .then((d) => {
        setDetail(d);
        setPickedEmail(d.research?.emails?.[0]?.email || '');
      })
      .catch(() => setDetail(null));
  }, [selectedId]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const customer = detail?.customer;
  const research = detail?.research || customer?.research;
  const sources = Object.entries(facets.sources || {}).sort((a, b) => b[1] - a[1]);

  const runResearch = async (id) => {
    setBusy(true);
    setErr('');
    try {
      const data = await api.rfqResearch(id);
      setDetail(data);
      setPickedEmail(data.research?.emails?.[0]?.email || '');
      await load();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const applyContact = async () => {
    if (!customer || !pickedEmail) return;
    if (!window.confirm(`把 ${pickedEmail} 写入该线索？若 Agent 正在运行，可能自动给这个公开角色邮箱写开发信。`)) return;
    setBusy(true);
    setErr('');
    try {
      const data = await api.rfqApplyContact(customer.id, {
        email: pickedEmail,
        website: research?.website || customer.website,
        company: research?.legalName || customer.company,
      });
      setDetail({ customer: data.customer, research });
      await load();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-page">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-[17px] font-semibold text-slate-800">
              <ScanSearch size={18} className="text-primary" />
              询盘获客
            </h1>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-500">
              入库后按外贸公式做公开背调：主体核验 → 官网 → 联系页/法律声明上的角色邮箱。
              只用 Wikidata、GLEIF、Wikipedia 和对方官网，不扒私人邮箱、不绕登录墙、不猜测 purchase@ 域名群发。
            </p>
          </div>
          <div className="flex shrink-0 gap-2 text-[11px]">
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-600">线索 {facets.total || 0}</span>
            <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-amber-600">待补邮箱 {facets.needEmail || 0}</span>
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-600">已有邮箱 {facets.hasEmail || 0}</span>
            <span className="rounded-lg bg-primary-light px-2.5 py-1 text-primary">已背调 {facets.researched || 0}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex h-9 w-[280px] items-center gap-1.5 rounded-lg bg-slate-100 px-2.5">
            <Search size={14} className="text-slate-400" />
            <input
              value={q}
              onChange={(e) => {
                setPage(0);
                setQ(e.target.value);
              }}
              placeholder="搜公司、国家、询盘摘要"
              className="w-full bg-transparent text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <select
            value={source}
            onChange={(e) => {
              setPage(0);
              setSource(e.target.value);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600"
          >
            <option value="">全部来源</option>
            {sources.map(([name, count]) => (
              <option key={name} value={name}>
                {name} ({count})
              </option>
            ))}
          </select>
          <select
            value={quality}
            onChange={(e) => {
              setPage(0);
              setQuality(e.target.value);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600"
          >
            <option value="company">像公司名（可背调）</option>
            <option value="">全部显示名</option>
            <option value="person">只有个人昵称</option>
          </select>
          <div className="flex gap-1">
            {CONTACT_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setPage(0);
                  setContact(f.key);
                }}
                className={`h-9 rounded-lg px-3 text-xs ${
                  contact === f.key ? 'bg-primary text-white' : 'border border-slate-200 bg-white text-slate-600'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {err && <div className="mx-6 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{err}</div>}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="thin-scroll flex-1 overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-page text-[11px] text-slate-400">
                <tr>
                  <th className="px-6 py-2 font-medium">买家 / 公司</th>
                  <th className="px-3 py-2 font-medium">来源</th>
                  <th className="px-3 py-2 font-medium">国家</th>
                  <th className="px-3 py-2 font-medium">联系方式</th>
                  <th className="px-3 py-2 font-medium">背调</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const active = c.id === selectedId;
                  const conf = c.research?.confidence;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={`cursor-pointer border-t border-slate-100 ${active ? 'bg-primary-light' : 'bg-white hover:bg-slate-50'}`}
                    >
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={c.company || c.name} size={32} />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-800">{c.company || c.name}</div>
                            <div className="truncate text-[11px] text-slate-400">{c.painPoints || c.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-500">{c.source || '—'}</td>
                      <td className="px-3 py-3 text-slate-500">{c.country || '—'}</td>
                      <td className="px-3 py-3">
                        {c.email ? (
                          <span className="text-emerald-600">{c.email}</span>
                        ) : (
                          <span className="text-amber-600">待背调</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {c.research?.status === 'done' ? (
                          <span className={`rounded px-1.5 py-0.5 text-[11px] ${CONFIDENCE[conf]?.cls || CONFIDENCE.low.cls}`}>
                            {CONFIDENCE[conf]?.label || '已完成'}
                          </span>
                        ) : c.research?.status === 'running' ? (
                          '进行中'
                        ) : (
                          <span className="text-slate-400">未做</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center text-slate-400">
                      没有符合条件的询盘。可先在开发信页用数据库图标拉公开 RFQ。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
                <Spinner /> 加载线索
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-1.5 border-t border-slate-100 bg-white py-3">
            <button
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-2 text-xs text-slate-500">
              {page + 1} / {pages} · {total} 条
            </span>
            <button
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <aside className="thin-scroll w-[420px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-5">
          {!customer ? (
            <div className="py-16 text-center text-xs text-slate-400">选择左侧一条询盘</div>
          ) : (
            <div className="fade-in-up">
              <div className="flex items-start gap-3">
                <Avatar name={customer.company || customer.name} size={44} />
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-slate-800">{customer.company || customer.name}</div>
                  <div className="mt-0.5 text-[12px] text-slate-400">
                    {customer.source} · {customer.country || '国家未知'}
                  </div>
                </div>
              </div>

              {customer.sourceUrl && (
                <a
                  href={customer.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
                >
                  打开原始询盘 <ExternalLink size={12} />
                </a>
              )}

              <p className="mt-3 text-[12px] leading-relaxed text-slate-600">{customer.painPoints || '无询盘摘要'}</p>

              <button
                onClick={() => runResearch(customer.id)}
                disabled={busy}
                className="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-medium text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {busy ? <Spinner className="h-3! w-3!" /> : <ScanSearch size={14} />}
                {research?.status === 'done' ? '重新公开背调' : '按外贸公式背调'}
              </button>

              {research?.status === 'running' && (
                <p className="mt-2 text-[12px] text-slate-500">正在查 Wikidata / GLEIF / 官网联系页…</p>
              )}
              {research?.status === 'failed' && (
                <p className="mt-2 text-[12px] text-rose-500">{research.error || '背调失败'}</p>
              )}

              {research?.status === 'done' && (
                <div className="mt-5 space-y-4">
                  <div className="flex flex-wrap gap-1.5">
                    {(research.steps || []).map((s) => (
                      <Pill key={s.key} ok={s.ok}>
                        {s.label}
                      </Pill>
                    ))}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${CONFIDENCE[research.confidence]?.cls || ''}`}>
                      置信度 {CONFIDENCE[research.confidence]?.label || research.confidence}
                    </span>
                  </div>

                  <p className="text-[12px] leading-relaxed text-slate-700">{research.brief}</p>

                  {research.website && (
                    <div className="flex items-start gap-2 text-[12px] text-slate-600">
                      <Globe size={14} className="mt-0.5 text-slate-400" />
                      <a href={research.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {research.website}
                      </a>
                    </div>
                  )}

                  <div>
                    <div className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold text-slate-700">
                      <Mail size={13} /> 公开角色邮箱
                    </div>
                    {research.emails?.length ? (
                      <div className="space-y-1.5">
                        {research.emails.map((e) => (
                          <label key={e.email} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
                            <input
                              type="radio"
                              name="email"
                              checked={pickedEmail === e.email}
                              onChange={() => setPickedEmail(e.email)}
                            />
                            <span className="text-[12px] text-slate-700">{e.email}</span>
                            <span className="ml-auto text-[10px] text-slate-400">{e.role}</span>
                          </label>
                        ))}
                        <button
                          onClick={applyContact}
                          disabled={busy || !pickedEmail}
                          className="mt-1 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-800 text-[12px] font-medium text-white disabled:opacity-40"
                        >
                          <ShieldCheck size={13} />
                          确认写入并交给开发信 Agent
                        </button>
                      </div>
                    ) : (
                      <p className="text-[12px] leading-relaxed text-slate-500">
                        这次没有拿到可验证的公开邮箱。大公司常用联系表单；阿里公开 RFQ 往往只有昵称。
                      </p>
                    )}
                  </div>

                  {research.phones?.length > 0 && (
                    <div className="text-[12px] text-slate-600">公开电话：{research.phones.join(' · ')}</div>
                  )}

                  {research.outreachAdvice && (
                    <div className="rounded-xl bg-primary-light p-3 text-[12px] leading-relaxed text-slate-700">
                      {research.outreachAdvice}
                    </div>
                  )}

                  {research.risks?.length > 0 && (
                    <div className="flex gap-2 text-[12px] text-amber-700">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>{research.risks.join('；')}</span>
                    </div>
                  )}

                  {research.facts?.length > 0 && (
                    <dl className="space-y-1.5">
                      {research.facts.slice(0, 8).map((f) => (
                        <div key={`${f.label}-${f.value}`} className="flex gap-2 text-[11px]">
                          <dt className="w-16 shrink-0 text-slate-400">{f.label}</dt>
                          <dd className="text-slate-600">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
