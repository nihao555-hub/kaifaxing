import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Mail,
  Globe,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Database,
  TrendingUp,
  Inbox,
  BadgeCheck,
  Clock,
  Building2,
  UserRound,
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
  high: { label: '高置信', cls: 'bg-emerald-50 text-emerald-600' },
  medium: { label: '中置信', cls: 'bg-amber-50 text-amber-600' },
  low: { label: '低置信', cls: 'bg-slate-100 text-slate-500' },
  none: { label: '无法核验', cls: 'bg-rose-50 text-rose-500' },
};

const FLAGS = {
  英国: '🇬🇧', UK: '🇬🇧', GB: '🇬🇧',
  美国: '🇺🇸', US: '🇺🇸', USA: '🇺🇸',
  德国: '🇩🇪', DE: '🇩🇪',
  荷兰: '🇳🇱', Netherlands: '🇳🇱', NL: '🇳🇱',
  法国: '🇫🇷', FR: '🇫🇷',
  印度: '🇮🇳', IN: '🇮🇳', India: '🇮🇳',
  中国: '🇨🇳', CN: '🇨🇳',
  波兰: '🇵🇱', PL: '🇵🇱',
  西班牙: '🇪🇸', ES: '🇪🇸',
  意大利: '🇮🇹', IT: '🇮🇹',
  芬兰: '🇫🇮', FI: '🇫🇮',
  Indonesia: '🇮🇩', Kenya: '🇰🇪',
};

function flagOf(country) {
  return FLAGS[country] || '🌐';
}

function formatTime(iso) {
  if (!iso) return '尚未执行';
  return String(iso).replace('T', ' ').slice(0, 16);
}

function MetricCard({ label, value, hint, icon: Icon, tone }) {
  const tones = {
    blue: 'bg-[#eaf1ff] text-primary',
    cyan: 'bg-sky-50 text-sky-600',
    amber: 'bg-amber-50 text-amber-500',
    green: 'bg-emerald-50 text-emerald-500',
    violet: 'bg-violet-50 text-violet-500',
  };
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-100 bg-white px-4 py-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] text-slate-400">{label}</div>
          <div className="mt-1 text-[22px] font-semibold tracking-tight text-slate-800">
            {Number(value || 0).toLocaleString()}
          </div>
          {hint && <div className="mt-1 text-[11px] text-slate-400">{hint}</div>}
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${tones[tone]}`}>
          <Icon size={18} />
        </span>
      </div>
    </div>
  );
}

function PipelineStepper({ pipeline }) {
  const todayDone = pipeline?.lastDailyDate === pipeline?.today;
  const researching = Boolean(pipeline?.researchingId || pipeline?.queue > 0);
  const applied = (pipeline?.appliedToday || 0) > 0;
  const steps = [
    { key: 'sync', label: '拉当天新询盘', done: todayDone, active: pipeline?.syncStatus === 'running' },
    { key: 'research', label: '自动公开背调', done: (pipeline?.researchedToday || 0) > 0 && !researching, active: researching },
    { key: 'email', label: '写入角色邮箱', done: applied, active: false },
    { key: 'agent', label: '交给开发信 Agent', done: applied, active: false },
  ];
  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-5 py-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-slate-800">今日流水线</div>
        <div className="text-[11px] text-slate-400">
          北京 {String(pipeline?.dailyHour ?? 7).padStart(2, '0')}:00 定时 · 队列 {pipeline?.queue ?? 0} · 上次同步 {formatTime(pipeline?.lastDailyAt)}
        </div>
      </div>
      <div className="flex items-center">
        {steps.map((s, i) => (
          <div key={s.key} className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                  s.done
                    ? 'bg-emerald-500 text-white'
                    : s.active
                      ? 'pulse-ring bg-primary text-white'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {s.done ? '✓' : i + 1}
              </span>
              <span className={`truncate text-[12px] ${s.done || s.active ? 'font-medium text-slate-700' : 'text-slate-400'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`mx-3 h-px flex-1 ${s.done ? 'bg-emerald-200' : 'bg-slate-100'}`} />
            )}
          </div>
        ))}
      </div>
    </div>
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
  const [pipeline, setPipeline] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await api.rfqLeads({ q, source, contact, quality, limit, offset: page * limit });
      setRows(data.items || []);
      setTotal(data.total || 0);
      if (data.facets) setFacets(data.facets);
      if (data.pipeline) setPipeline(data.pipeline);
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
    const timer = setInterval(async () => {
      try {
        const st = await api.rfqPipeline();
        setPipeline(st);
        if (st.syncStatus === 'running' || st.queue > 0 || st.researchingId) load();
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(timer);
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
  const sources = useMemo(
    () => Object.entries(facets.sources || {}).sort((a, b) => b[1] - a[1]),
    [facets.sources]
  );

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

  const syncToday = async () => {
    setSyncing(true);
    setErr('');
    try {
      setPipeline(await api.rfqPipelineSync());
      await load();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="thin-scroll relative min-w-0 flex-1 overflow-y-auto bg-page">
      <div className="pointer-events-none absolute top-0 right-8 h-[220px] w-[420px] opacity-70">
        <img src="/leads/world-map.svg" alt="" className="h-full w-full object-contain" />
      </div>

      <div className="relative px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <img src="/leads/hero-globe.webp" alt="" className="h-[88px] w-[88px] object-contain" />
            <div>
              <div className="flex items-center gap-2">
                <img src="/leads/formula-badge.webp" alt="" className="h-7 w-7 rounded-lg shadow-sm" />
                <h1 className="text-[20px] font-semibold tracking-tight text-slate-800">询盘获客</h1>
              </div>
              <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-slate-500">
                每日自动拉新询盘 · 入库即背调 · 只写入公开角色邮箱
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <button
              onClick={() => setShowLog((v) => !v)}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12px] text-slate-600 hover:bg-slate-50"
            >
              <Clock size={13} />
              查看同步记录
            </button>
            <button
              onClick={syncToday}
              disabled={syncing || pipeline?.syncStatus === 'running'}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-[12px] font-medium text-white shadow-sm shadow-primary/25 hover:bg-blue-600 disabled:opacity-50"
            >
              {syncing || pipeline?.syncStatus === 'running' ? <Spinner className="h-3! w-3!" /> : <RefreshCw size={13} />}
              立即同步今天
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-5 gap-3">
          <MetricCard label="库内" value={facets.total} hint="全部公开询盘" icon={Database} tone="blue" />
          <MetricCard label="今日新增" value={pipeline?.todayNew ?? facets.todayNew} hint="当天入库" icon={TrendingUp} tone="cyan" />
          <MetricCard label="待补邮箱" value={facets.needEmail} hint="还没有公开联系方式" icon={Inbox} tone="amber" />
          <MetricCard label="已有邮箱" value={facets.hasEmail} hint="可交给开发信" icon={Mail} tone="green" />
          <MetricCard label="已背调" value={facets.researched} hint={`今日 ${pipeline?.researchedToday || 0} 条`} icon={BadgeCheck} tone="violet" />
        </div>

        <div className="mt-3">
          <PipelineStepper pipeline={pipeline} />
        </div>

        {showLog && pipeline && (
          <div className="mt-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-[12px] leading-relaxed text-slate-500 shadow-sm">
            北京时间 {pipeline.today}。上次同步 {formatTime(pipeline.lastDailyAt)}
            {pipeline.lastSync ? `，抓到 ${pipeline.lastSync.fetched} / 新入库 ${pipeline.lastSync.createdCount}` : ''}
            。队列 {pipeline.queue} · 今日已背调 {pipeline.researchedToday} · 自动写入邮箱 {pipeline.appliedToday}
            {pipeline.researchingId ? ' · 正在背调…' : ''}
            {pipeline.lastError ? ` · ${pipeline.lastError}` : ''}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
          <div className="flex h-9 w-[260px] items-center gap-1.5 rounded-xl bg-slate-100 px-2.5">
            <Search size={14} className="text-slate-400" />
            <input
              value={q}
              onChange={(e) => {
                setPage(0);
                setQ(e.target.value);
              }}
              placeholder="搜公司、买家、询盘摘要"
              className="w-full bg-transparent text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <select
            value={source}
            onChange={(e) => {
              setPage(0);
              setSource(e.target.value);
            }}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-600"
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
            className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-600"
          >
            <option value="company">像公司名</option>
            <option value="">全部显示名</option>
            <option value="person">只有个人昵称</option>
          </select>
          <div className="ml-auto flex gap-1">
            {CONTACT_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setPage(0);
                  setContact(f.key);
                }}
                className={`h-9 rounded-xl px-3 text-xs ${
                  contact === f.key ? 'bg-primary text-white shadow-sm shadow-primary/20' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {err && <div className="mx-6 mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{err}</div>}

      <div className="flex min-h-[520px] gap-4 px-6 pb-5">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="thin-scroll flex-1 overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-white text-[11px] text-slate-400">
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-2.5 font-medium">买家 / 公司</th>
                  <th className="px-3 py-2.5 font-medium">来源</th>
                  <th className="px-3 py-2.5 font-medium">国家</th>
                  <th className="px-3 py-2.5 font-medium">联系方式</th>
                  <th className="px-3 py-2.5 font-medium">背调</th>
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
                      className={`cursor-pointer border-b border-slate-50 ${active ? 'bg-primary-light' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={c.company || c.name} size={32} />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-800">{c.company || c.name}</div>
                            <div className="truncate text-[11px] text-slate-400">{c.painPoints || c.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">{c.source || '—'}</span>
                      </td>
                      <td className="px-3 py-3 text-slate-500">
                        <span className="mr-1">{flagOf(c.country)}</span>
                        {c.country || '—'}
                      </td>
                      <td className="px-3 py-3">
                        {c.email ? (
                          <span className="text-emerald-600">{c.email}</span>
                        ) : (
                          <span className="text-amber-500">待补邮箱</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {c.research?.status === 'done' ? (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${CONFIDENCE[conf]?.cls || CONFIDENCE.low.cls}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${conf === 'high' ? 'bg-emerald-500' : conf === 'medium' ? 'bg-amber-400' : 'bg-slate-400'}`} />
                            {CONFIDENCE[conf]?.label || '已完成'}
                          </span>
                        ) : c.research?.status === 'running' ? (
                          <span className="text-primary">进行中</span>
                        ) : (
                          <span className="text-slate-400">未做</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center">
                      <img src="/leads/empty.webp" alt="" className="mx-auto h-40 w-auto object-contain" />
                      <div className="mt-3 text-xs text-slate-400">没有符合条件的询盘，点右上角同步今天，或放宽筛选</div>
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
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
            <span className="text-[11px] text-slate-400">共 {total.toLocaleString()} 条</span>
            <div className="flex items-center gap-1.5">
              <button
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="px-2 text-xs text-slate-500">
                {page + 1} / {pages}
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
        </div>

        <aside className="thin-scroll relative w-[400px] shrink-0 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <img src="/leads/world-map.svg" alt="" className="pointer-events-none absolute top-3 right-3 h-16 w-28 opacity-50" />
          {!customer ? (
            <div className="py-16 text-center">
              <img src="/leads/empty.webp" alt="" className="mx-auto h-36 w-auto object-contain" />
              <div className="mt-2 text-xs text-slate-400">选择左侧一条询盘，查看外贸公式背调</div>
            </div>
          ) : (
            <div className="fade-in-up relative">
              <div className="flex items-start gap-3">
                <Avatar name={customer.company || customer.name} size={48} />
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-slate-800">{customer.company || customer.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    <span className="rounded-md bg-slate-50 px-1.5 py-0.5">{customer.source || '公开询盘'}</span>
                    <span>{flagOf(customer.country)} {customer.country || '国家未知'}</span>
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
                className="mt-4 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-[13px] font-medium text-white shadow-sm shadow-primary/25 hover:bg-blue-600 disabled:opacity-50"
              >
                {busy ? <Spinner className="h-3! w-3!" /> : <img src="/leads/formula-badge.webp" alt="" className="h-5 w-5 rounded" />}
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
                  <div>
                    <div className="mb-2 text-[12px] font-semibold text-slate-700">外贸公式</div>
                    <div className="space-y-2.5">
                      {(research.steps || []).map((s) => (
                        <div key={s.key} className="flex gap-2.5">
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${s.ok ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                            {s.ok ? '✓' : '–'}
                          </span>
                          <div>
                            <div className="text-[12px] font-medium text-slate-700">{s.label}</div>
                            <div className="text-[11px] leading-relaxed text-slate-400">{s.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${CONFIDENCE[research.confidence]?.cls || ''}`}>
                    置信度 {CONFIDENCE[research.confidence]?.label || research.confidence}
                  </span>

                  {research.brief && (
                    <p className="text-[12px] leading-relaxed text-slate-600">{research.brief}</p>
                  )}

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
                          <label
                            key={e.email}
                            className={`flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 ${
                              pickedEmail === e.email ? 'border-primary bg-primary-light' : 'border-slate-200'
                            }`}
                          >
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
                          className="mt-1 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-[12px] font-medium text-white disabled:opacity-40"
                        >
                          <ShieldCheck size={13} />
                          确认写入
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

              {!research?.status && (
                <div className="mt-6 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-2">
                    <Building2 size={12} /> 主体核验
                  </div>
                  <div className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-2">
                    <Globe size={12} /> 官网定位
                  </div>
                  <div className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-2">
                    <Mail size={12} /> 公开联系方式
                  </div>
                  <div className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-2">
                    <UserRound size={12} /> 采购意图
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
