import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Mail,
  ShieldCheck,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import { Spinner } from './common.jsx';
import CountryFlag from './CountryFlag.jsx';
import { countryLabel, countrySearchText, groupCountryFacets } from '../countries.js';

const TABS = [
  { key: 'all', label: '采购商询盘' },
  { key: 'today', label: '今日新增' },
  { key: 'need_email', label: '待挖邮箱' },
  { key: 'has_email', label: '已有联系人' },
];

const DRAWER_TABS = [
  { key: 'basic', label: '基本信息' },
  { key: 'rfq', label: '询盘详情' },
  { key: 'research', label: '公开背调' },
  { key: 'contacts', label: '联系人' },
];

function formatTime(iso) {
  if (!iso) return '尚未执行';
  return String(iso).replace('T', ' ').slice(0, 16);
}

function snippetOf(c) {
  return c.painPoints || c.rfq?.title || c.title || '—';
}

function companyOf(c) {
  return c.company || c.name || '未命名买家';
}

function toggleValue(list, value) {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function pageNumbers(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const items = [0];
  const start = Math.max(1, page - 1);
  const end = Math.min(pages - 2, page + 1);
  if (start > 1) items.push('…');
  for (let i = start; i <= end; i += 1) items.push(i);
  if (end < pages - 2) items.push('…');
  items.push(pages - 1);
  return items;
}

function useOutsideClose(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);
  return ref;
}

function FilterMenu({ label, summary, active, width = 220, children }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 max-w-[220px] items-center gap-1 rounded border px-2.5 text-[12px] ${
          active ? 'border-primary bg-primary-light text-primary' : 'border-[#dbe2ea] bg-white text-[#475569] hover:border-[#c5cedb]'
        }`}
      >
        <span className="truncate">{summary ? `${label}：${summary}` : label}</span>
        <ChevronDown size={13} className={`shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute top-[calc(100%+4px)] left-0 z-30 rounded border border-[#e8edf4] bg-white py-1 shadow-lg"
          style={{ width }}
          onClick={(e) => {
            if (e.target.closest('[data-close-menu]')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuOption({ active, onClick, label, count, leading }) {
  return (
    <button
      type="button"
      data-close-menu
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[#f7f9fc] ${
        active ? 'text-primary' : 'text-[#475569]'
      }`}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && <span className="shrink-0 text-[11px] text-[#94a3b8]">{count.toLocaleString()}</span>}
    </button>
  );
}

function ResearchStatus({ status }) {
  if (status === 'done') return <span className="text-[12px] text-emerald-600">已背调</span>;
  if (status === 'running') return <span className="text-[12px] text-primary">背调中</span>;
  if (status === 'failed') return <span className="text-[12px] text-rose-500">失败</span>;
  return <span className="text-[12px] text-[#94a3b8]">未背调</span>;
}

export default function LeadsPage({ onGoOutreach }) {
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const [countryKeys, setCountryKeys] = useState([]);
  const [countryQ, setCountryQ] = useState('');
  const [quality, setQuality] = useState('');
  const [researchFilter, setResearchFilter] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({ countries: {}, total: 0, needEmail: 0, hasEmail: 0, researched: 0 });
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('research');
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pickedEmail, setPickedEmail] = useState('');
  const [pipeline, setPipeline] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [checked, setChecked] = useState([]);
  const [okMsg, setOkMsg] = useState('');

  const countryGroups = useMemo(() => groupCountryFacets(facets.countries), [facets.countries]);
  const selectedNames = useMemo(
    () => countryGroups.filter((g) => countryKeys.includes(g.key)).flatMap((g) => g.names),
    [countryGroups, countryKeys]
  );

  const visibleCountries = useMemo(() => {
    const kw = countryQ.trim().toLowerCase();
    const matched = kw
      ? countryGroups.filter((g) =>
          [g.label, g.iso, ...g.names].some((n) => countrySearchText(n).includes(kw) || String(n).toLowerCase().includes(kw))
        )
      : countryGroups;
    if (kw) return matched.slice(0, 40);
    const selected = matched.filter((g) => countryKeys.includes(g.key));
    const rest = matched.filter((g) => !countryKeys.includes(g.key)).slice(0, 20);
    const keys = new Set();
    return [...selected, ...rest].filter((g) => (keys.has(g.key) ? false : keys.add(g.key)));
  }, [countryGroups, countryQ, countryKeys]);

  const query = useMemo(() => ({
    q,
    country: selectedNames.join(','),
    contact: tab === 'need_email' ? 'missing' : tab === 'has_email' ? 'found' : '',
    quality,
    research: researchFilter,
    today: tab === 'today',
    limit,
    offset: page * limit,
  }), [q, tab, selectedNames, quality, researchFilter, limit, page]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await api.rfqLeads(query);
      setRows(data.items || []);
      setTotal(data.total || 0);
      if (data.facets) setFacets(data.facets);
      if (data.pipeline) setPipeline(data.pipeline);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [query]);

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
    if (!selectedId || !drawerOpen) return;
    api.rfqLead(selectedId)
      .then((d) => {
        setDetail(d);
        setPickedEmail(d.research?.emails?.[0]?.email || d.customer?.email || '');
      })
      .catch(() => setDetail(null));
  }, [selectedId, drawerOpen]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const customer = detail?.customer;
  const research = detail?.research || customer?.research;

  const openDrawer = (id, nextTab = 'research') => {
    setSelectedId(id);
    setDrawerTab(nextTab);
    setDrawerOpen(true);
  };

  const runResearch = async (id) => {
    setBusy(true);
    setErr('');
    try {
      const data = await api.rfqResearch(id);
      setSelectedId(id);
      setDetail(data);
      setPickedEmail(data.research?.emails?.[0]?.email || '');
      setDrawerOpen(true);
      setDrawerTab('research');
      await load();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const promoteToOutreach = async (ids, { applyEmail } = {}) => {
    if (!ids.length) return;
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      if (applyEmail && ids[0]) {
        await api.rfqApplyContact(ids[0], {
          email: applyEmail,
          website: research?.website || customer?.website,
          company: research?.legalName || customer?.company,
        });
      }
      const promo = await api.rfqPromote(ids);
      const n = promo.promoted?.length || 0;
      const skip = promo.skipped?.length || 0;
      if (!n) {
        setErr(promo.skipped?.[0]?.reason || '选中的询盘还没有可发信的公开角色邮箱');
        await load();
        return;
      }
      setOkMsg(`已录入开发信 ${n} 家${skip ? `，跳过 ${skip} 家` : ''}，Agent 已开始自动研究、写信并按时区排期`);
      setChecked([]);
      await load();
      onGoOutreach?.();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const applyContact = async () => {
    if (!customer) return;
    if (pickedEmail && !window.confirm(`把 ${pickedEmail} 写入该线索并录入开发信？Agent 会自动给这个公开角色邮箱写信。`)) return;
    await promoteToOutreach([customer.id], { applyEmail: pickedEmail || undefined });
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

  const resetFilters = () => {
    setCountryKeys([]);
    setCountryQ('');
    setQuality('');
    setResearchFilter('');
    setPage(0);
  };

  const countrySummary = useMemo(() => {
    if (!countryKeys.length) return '';
    const first = countryGroups.find((g) => g.key === countryKeys[0])?.label || '';
    return countryKeys.length === 1 ? first : `${first} 等${countryKeys.length}国`;
  }, [countryKeys, countryGroups]);
  const qualityLabel = quality === 'company' ? '公司名' : quality === 'person' ? '个人昵称' : '';
  const researchLabel = researchFilter === 'done' ? '已背调' : researchFilter === 'none' ? '未背调' : '';
  const hasFilters = countryKeys.length > 0 || quality || researchFilter;

  const allChecked = rows.length > 0 && rows.every((r) => checked.includes(r.id));
  const batchResearch = async () => {
    const ids = checked.slice(0, 5);
    if (!ids.length) return;
    setBusy(true);
    setErr('');
    try {
      await api.rfqResearchBatch(ids);
      await load();
      setOkMsg(`已提交 ${ids.length} 条公开背调`);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <header className="shrink-0 border-b border-[#e8edf4] px-6 pt-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="text-[20px] font-semibold tracking-tight text-[#1e293b]">询盘获客</h1>
            <p className="truncate text-[12px] text-[#94a3b8]">
              每日 {String(pipeline?.dailyHour ?? 7).padStart(2, '0')}:00 自动更新
              <span className="mx-1.5 text-[#e2e8f0]">·</span>
              今日新增 {(pipeline?.todayNew ?? facets.todayNew ?? 0).toLocaleString()}
              {(pipeline?.queue || 0) > 0 && (
                <>
                  <span className="mx-1.5 text-[#e2e8f0]">·</span>
                  背调队列 {pipeline.queue}
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              className="flex h-8 items-center gap-1.5 rounded border border-[#dbe2ea] bg-white px-3 text-[12px] text-[#475569] hover:bg-[#f8fafc]"
            >
              <RefreshCw size={13} />
              同步记录
            </button>
            <button
              type="button"
              onClick={syncToday}
              disabled={syncing || pipeline?.syncStatus === 'running'}
              className="flex h-8 items-center gap-1.5 rounded bg-primary px-3.5 text-[12px] font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {syncing || pipeline?.syncStatus === 'running' ? <Spinner className="h-3! w-3!" /> : <RefreshCw size={13} />}
              立即同步
            </button>
          </div>
        </div>

        {showLog && pipeline && (
          <div className="mt-3 rounded border border-[#e8edf4] bg-[#f8fafc] px-3 py-2 text-[12px] leading-relaxed text-[#64748b]">
            北京时间 {pipeline.today}。上次同步 {formatTime(pipeline.lastDailyAt)}
            {pipeline.lastSync ? `，抓到 ${pipeline.lastSync.fetched} / 新入库 ${pipeline.lastSync.createdCount}` : ''}
            。队列 {pipeline.queue} · 今日已背调 {pipeline.researchedToday} · 自动写入邮箱 {pipeline.appliedToday}
            {pipeline.researchingId ? ' · 正在背调…' : ''}
            {pipeline.lastError ? ` · ${pipeline.lastError}` : ''}
          </div>
        )}

        <form
          className="leads-search mt-4 flex h-10 overflow-hidden rounded border border-[#d7dee8] bg-white"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setQ(draftQ.trim());
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
            <Search size={15} className="shrink-0 text-[#94a3b8]" />
            <input
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              placeholder="输入产品词、公司名或询盘摘要，如 cordless drill"
              className="h-full w-full bg-transparent text-[13px] text-[#334155] placeholder:text-[#94a3b8] focus:outline-none"
            />
          </div>
          <button type="submit" className="h-full w-[88px] shrink-0 bg-primary text-[13px] font-medium text-white hover:bg-blue-600">
            搜索
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FilterMenu label="国家/地区" summary={countrySummary} active={countryKeys.length > 0} width={280}>
            <div className="px-2 py-1.5">
              <div className="flex h-8 items-center gap-1.5 rounded border border-[#e2e8f0] bg-[#f8fafc] px-2">
                <Search size={12} className="text-[#94a3b8]" />
                <input
                  value={countryQ}
                  onChange={(e) => setCountryQ(e.target.value)}
                  placeholder="搜索国家，如 美国 / US"
                  className="h-full w-full bg-transparent text-[12px] text-[#334155] placeholder:text-[#94a3b8] focus:outline-none"
                />
              </div>
            </div>
            <div className="thin-scroll max-h-64 overflow-y-auto">
              {visibleCountries.map((g) => (
                <label
                  key={g.key}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] text-[#475569] hover:bg-[#f7f9fc]"
                >
                  <input
                    type="checkbox"
                    checked={countryKeys.includes(g.key)}
                    onChange={() => {
                      setPage(0);
                      setCountryKeys((cur) => toggleValue(cur, g.key));
                    }}
                    className="accent-primary"
                  />
                  <CountryFlag country={g.iso || g.names[0]} size={14} />
                  <span className="min-w-0 flex-1 truncate">{g.label}</span>
                  <span className="text-[11px] text-[#94a3b8]">{g.count.toLocaleString()}</span>
                </label>
              ))}
              {countryQ && visibleCountries.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-[#94a3b8]">没有匹配的国家</div>
              )}
            </div>
          </FilterMenu>

          <FilterMenu label="线索类型" summary={qualityLabel} active={Boolean(quality)}>
            <MenuOption active={!quality} label="全部" onClick={() => { setQuality(''); setPage(0); }} />
            <MenuOption active={quality === 'company'} label="公司名" onClick={() => { setQuality('company'); setPage(0); }} />
            <MenuOption active={quality === 'person'} label="个人昵称" onClick={() => { setQuality('person'); setPage(0); }} />
          </FilterMenu>

          <FilterMenu label="背调状态" summary={researchLabel} active={Boolean(researchFilter)}>
            <MenuOption active={!researchFilter} label="全部" onClick={() => { setResearchFilter(''); setPage(0); }} />
            <MenuOption active={researchFilter === 'none'} label="未背调" onClick={() => { setResearchFilter('none'); setPage(0); }} />
            <MenuOption
              active={researchFilter === 'done'}
              label="已背调"
              count={facets.researched}
              onClick={() => { setResearchFilter('done'); setPage(0); }}
            />
          </FilterMenu>

          {hasFilters && (
            <button type="button" onClick={resetFilters} className="flex h-8 items-center gap-1 px-1.5 text-[12px] text-[#94a3b8] hover:text-primary">
              <RotateCcw size={12} />
              重置
            </button>
          )}
        </div>

        <div className="mt-2 flex items-end gap-7">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setPage(0);
                setChecked([]);
              }}
              className={`relative h-10 text-[13px] ${
                tab === t.key ? 'font-medium text-primary' : 'text-[#64748b] hover:text-[#334155]'
              }`}
            >
              {t.label}
              {t.key === 'today' && (pipeline?.todayNew || 0) > 0 && (
                <span className="ml-1 text-[11px] text-[#94a3b8]">{pipeline.todayNew}</span>
              )}
              {tab === t.key && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
      </header>

      {(err || okMsg) && (
        <div className="shrink-0 px-6 pt-3">
          {err && <div className="rounded border border-rose-100 bg-rose-50 px-3 py-1.5 text-[12px] text-rose-600">{err}</div>}
          {okMsg && !err && (
            <div className="flex items-center justify-between rounded border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-700">
              <span>{okMsg}</span>
              {onGoOutreach && (
                <button type="button" className="text-primary hover:underline" onClick={onGoOutreach}>
                  去开发信
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col bg-white">
          {checked.length > 0 && (
            <div className="flex h-9 items-center gap-3 border-b border-[#eef1f6] bg-[#f7f9fc] px-4 text-[12px] text-[#475569]">
              <span>已选 {checked.length} 条</span>
              <button type="button" onClick={batchResearch} disabled={busy} className="text-primary hover:underline disabled:opacity-50">
                批量挖邮箱
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => promoteToOutreach(checked)}
                className="text-primary hover:underline disabled:opacity-50"
              >
                {busy ? '正在背调并录入…' : '录入开发信'}
              </button>
              <button type="button" onClick={() => setChecked([])} className="text-[#94a3b8] hover:text-[#475569]">
                取消选择
              </button>
            </div>
          )}

          <div className="thin-scroll min-h-0 flex-1 overflow-auto">
            <table className="w-full table-fixed text-left text-[12px]">
              <thead className="sticky top-0 z-10 bg-[#f8fafc] text-[12px] font-medium text-[#94a3b8]">
                <tr className="border-b border-[#e8edf4]">
                  <th className="w-11 px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) => setChecked(e.target.checked ? rows.map((r) => r.id) : [])}
                      className="accent-primary"
                    />
                  </th>
                  <th className="w-[20%] px-3 py-2.5">公司/买家</th>
                  <th className="w-[12%] px-3 py-2.5">国家</th>
                  <th className="px-3 py-2.5">询盘摘要</th>
                  <th className="w-[18%] px-3 py-2.5">联系人</th>
                  <th className="w-[9%] px-3 py-2.5">背调</th>
                  <th className="w-[12%] px-3 py-2.5">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const active = c.id === selectedId && drawerOpen;
                  return (
                    <tr key={c.id} className={`border-b border-[#f1f5f9] ${active ? 'bg-primary-light' : 'hover:bg-[#f8fafc]'}`}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={checked.includes(c.id)}
                          onChange={() => setChecked((cur) => toggleValue(cur, c.id))}
                          className="accent-primary"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => openDrawer(c.id, 'research')}
                          className="block w-full truncate text-left font-medium text-primary hover:underline"
                          title={companyOf(c)}
                        >
                          {companyOf(c)}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[#475569]">
                          <CountryFlag country={c.country} size={16} />
                          <span className="truncate">{countryLabel(c.country)}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="line-clamp-2 leading-5 text-[#64748b]" title={snippetOf(c)}>
                          {snippetOf(c)}
                        </span>
                      </td>
                      <td className="truncate px-3 py-3">
                        {c.email ? <span className="text-primary">{c.email}</span> : <span className="text-[#cbd5e1]">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <ResearchStatus status={c.research?.status} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => runResearch(c.id)}
                            disabled={busy}
                            className="text-primary hover:underline disabled:opacity-40"
                          >
                            挖邮箱
                          </button>
                          <button type="button" onClick={() => openDrawer(c.id, 'research')} className="text-[#64748b] hover:underline">
                            详情
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center text-[13px] text-[#94a3b8]">
                      没有符合条件的询盘，试试换关键词或放宽筛选
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {loading && (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-[#94a3b8]">
                <Spinner /> 加载询盘
              </div>
            )}
          </div>

          <div className="flex h-12 shrink-0 items-center justify-between border-t border-[#e8edf4] px-4 text-[12px] text-[#64748b]">
            <span>共 {total.toLocaleString()} 条</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="flex h-7 w-7 items-center justify-center rounded border border-[#dbe2ea] text-[#94a3b8] hover:bg-[#f8fafc] disabled:opacity-30"
                >
                  <ChevronLeft size={14} />
                </button>
                {pageNumbers(page, pages).map((item, i) =>
                  item === '…' ? (
                    <span key={`e${i}`} className="px-1 text-[#cbd5e1]">…</span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPage(item)}
                      className={`h-7 min-w-7 rounded px-1.5 ${
                        page === item ? 'bg-primary text-white' : 'border border-[#dbe2ea] text-[#475569] hover:bg-[#f8fafc]'
                      }`}
                    >
                      {item + 1}
                    </button>
                  )
                )}
                <button
                  type="button"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded border border-[#dbe2ea] text-[#94a3b8] hover:bg-[#f8fafc] disabled:opacity-30"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              <select
                value={limit}
                onChange={(e) => {
                  setPage(0);
                  setLimit(Number(e.target.value));
                }}
                className="h-7 rounded border border-[#dbe2ea] bg-white px-1.5 text-[12px]"
              >
                <option value={20}>20 条/页</option>
                <option value={50}>50 条/页</option>
                <option value={100}>100 条/页</option>
              </select>
            </div>
          </div>
      </div>

      {drawerOpen && (
        <div className="absolute inset-0 z-20 flex justify-end bg-slate-900/25" onClick={() => setDrawerOpen(false)}>
          <aside
            className="flex h-full w-[460px] flex-col border-l border-[#e8edf4] bg-white shadow-[-8px_0_24px_rgb(15_23_42/0.08)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#eef1f6] px-5 py-4">
              <div className="min-w-0 pr-3">
                <div className="truncate text-[16px] font-semibold text-[#1e293b]">{companyOf(customer || {})}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-[#64748b]">
                  <span className="inline-flex items-center gap-1.5">
                    <CountryFlag country={customer?.country} size={16} />
                    {countryLabel(customer?.country)}
                  </span>
                </div>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded p-1 text-[#94a3b8] hover:bg-[#f1f5f9]">
                <X size={16} />
              </button>
            </div>

            <div className="flex shrink-0 gap-5 border-b border-[#eef1f6] px-5">
              {DRAWER_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setDrawerTab(t.key)}
                  className={`relative h-10 text-[13px] ${drawerTab === t.key ? 'font-medium text-primary' : 'text-[#64748b]'}`}
                >
                  {t.label}
                  {drawerTab === t.key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
                </button>
              ))}
            </div>

            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {!customer ? (
                <div className="py-16 text-center text-[12px] text-[#94a3b8]">加载详情…</div>
              ) : (
                <DrawerBody
                  tab={drawerTab}
                  customer={customer}
                  research={research}
                  pickedEmail={pickedEmail}
                  setPickedEmail={setPickedEmail}
                />
              )}
            </div>

            <div className="flex shrink-0 gap-2 border-t border-[#eef1f6] px-5 py-3">
              <button
                type="button"
                onClick={() => customer && runResearch(customer.id)}
                disabled={busy || !customer}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded border border-primary text-[13px] font-medium text-primary hover:bg-primary-light disabled:opacity-40"
              >
                {busy ? <Spinner className="h-3! w-3!" /> : <Mail size={13} />}
                挖邮箱
              </button>
              <button
                type="button"
                onClick={applyContact}
                disabled={busy || !customer}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded bg-primary text-[13px] font-medium text-white hover:bg-blue-600 disabled:opacity-40"
              >
                <ShieldCheck size={13} />
                录入开发信
              </button>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function InfoRow({ label, value, href }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-1.5 text-[12px]">
      <dt className="w-16 shrink-0 text-[#94a3b8]">{label}</dt>
      <dd className="min-w-0 break-all text-[#334155]">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            {value} <ExternalLink size={11} />
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function factValue(research, re) {
  return research?.facts?.find((f) => re.test(f.label))?.value || '';
}

function researchChecks(customer, research) {
  const website = Boolean(research?.website || customer.website);
  const social = (research?.socials || []).length > 0
    || (research?.facts || []).some((f) => /LinkedIn|Facebook|^X$|Twitter|社媒/i.test(f.label));
  const registry = (research?.facts || []).some((f) =>
    /GLEIF|Wikidata|LEI|注册|工商|Sirene|Brreg|ROR|PRH|ARES|Receita|Companies House/i.test(`${f.source} ${f.label}`)
  );
  const procurement = Boolean(customer.sourceUrl || customer.awardId || customer.rfq || customer.painPoints);
  return [
    { label: '公司官网', ok: website },
    { label: '社交媒体', ok: social },
    { label: '工商信息', ok: registry },
    { label: '招投标/采购记录', ok: procurement },
  ];
}

function EmailPick({ emails, pickedEmail, setPickedEmail, name }) {
  if (!emails.length) return null;
  return (
    <div className="space-y-1.5">
      {emails.map((e, i) => (
        <label
          key={e.email}
          className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 ${
            pickedEmail === e.email ? 'border-primary bg-primary-light' : 'border-[#e2e8f0]'
          }`}
        >
          <input type="radio" name={name} checked={pickedEmail === e.email} onChange={() => setPickedEmail(e.email)} />
          <span className="text-[12px] text-[#334155]">{i + 1}. {e.email}</span>
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600">
            {e.role === 'info' || e.role === 'enquiry' || e.role === 'contact' ? '官网' : (e.role || '官网')}
          </span>
          <span className="ml-auto text-[10px] text-emerald-600">可用</span>
        </label>
      ))}
    </div>
  );
}

function DrawerBody({ tab, customer, research, pickedEmail, setPickedEmail }) {
  const address = research?.address || factValue(research, /注册地址|总部|地址/);
  const industry = research?.industry || factValue(research, /行业/) || customer.industry;
  const size = research?.employees || factValue(research, /员工规模/);
  const website = research?.website || customer.website;
  const emails = research?.emails?.length ? research.emails : (customer.email ? [{ email: customer.email, role: '官网' }] : []);

  if (tab === 'basic') {
    return (
      <dl>
        <InfoRow label="公司" value={customer.company || customer.name} />
        <InfoRow label="国家" value={countryLabel(customer.country)} />
        <InfoRow label="官网" value={website} href={website} />
        <InfoRow label="法人名" value={research?.legalName && research.legalName !== (customer.company || customer.name) ? research.legalName : ''} />
        <InfoRow label="行业" value={industry} />
        <InfoRow label="地址" value={address} />
        <InfoRow label="员工规模" value={size} />
      </dl>
    );
  }

  if (tab === 'rfq') {
    return (
      <div className="space-y-3 text-[12px] leading-relaxed text-[#475569]">
        <div>
          <div className="mb-1 text-[#94a3b8]">询盘摘要</div>
          <p>{snippetOf(customer)}</p>
        </div>
        {customer.ingestedAt && <div className="text-[#94a3b8]">入库时间 {formatTime(customer.ingestedAt)}</div>}
      </div>
    );
  }

  if (tab === 'contacts') {
    return (
      <div className="space-y-3">
        {emails.length ? (
          <EmailPick emails={emails} pickedEmail={pickedEmail} setPickedEmail={setPickedEmail} name="email" />
        ) : (
          <p className="text-[12px] text-[#94a3b8]">还没有可核验的公开角色邮箱。入库后会自动背调；也可点底部「挖邮箱」。</p>
        )}
        {research?.phones?.length > 0 && (
          <div className="text-[12px] text-[#475569]">公开电话：{research.phones.join(' · ')}</div>
        )}
      </div>
    );
  }

  const checks = researchChecks(customer, research);

  return (
    <div className="space-y-5">
      {research?.status === 'running' && <p className="text-[12px] text-[#64748b]">入库后已自动背调，正在查公开主体和官网联系页…</p>}
      {research?.status === 'failed' && <p className="text-[12px] text-rose-500">{research.error || '背调失败'}</p>}
      {!research?.status && (
        <p className="text-[12px] leading-relaxed text-[#64748b]">排队自动背调中。只查公开主体库和官网联系页，不扒私人邮箱。</p>
      )}

      <div className="space-y-2.5">
        {checks.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-[12px]">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${s.ok ? 'bg-emerald-500 text-white' : 'bg-[#e2e8f0] text-[#94a3b8]'}`}>
                {s.ok ? '✓' : '–'}
              </span>
              <span className="text-[#334155]">{s.label}</span>
            </div>
            <span className={s.ok ? 'text-emerald-600' : 'text-[#94a3b8]'}>{s.ok ? '已找到' : '未找到'}</span>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-2 text-[12px] font-medium text-[#334155]">公开角色邮箱</div>
        {emails.length ? (
          <EmailPick emails={emails} pickedEmail={pickedEmail} setPickedEmail={setPickedEmail} name="email-research" />
        ) : (
          <p className="text-[12px] leading-relaxed text-[#64748b]">
            {research?.status === 'done'
              ? '公开页没有明文角色邮箱。大公司常用联系表单；只有昵称的询盘核不到公司主体。'
              : '自动背调完成后，核到的官网角色邮箱会显示在这里。'}
          </p>
        )}
      </div>

      <div>
        <div className="mb-2 text-[12px] font-medium text-[#334155]">补充信息</div>
        <dl>
          <InfoRow label="电话" value={research?.phones?.join(' · ')} />
          <InfoRow label="官网" value={website} href={website} />
          <InfoRow label="地址" value={address} />
          <InfoRow label="行业" value={industry} />
          <InfoRow label="员工规模" value={size} />
          <InfoRow label="母公司" value={factValue(research, /最终母公司/)} />
          <InfoRow label="登记号" value={factValue(research, /登记号|SIREN|Org\.nr|IČO|CNPJ/)} />
          <InfoRow label="LEI" value={factValue(research, /^LEI$/)} />
        </dl>
        {!website && !address && !industry && !size && !research?.phones?.length && (
          <p className="text-[12px] text-[#94a3b8]">还没有核到补充信息。</p>
        )}
      </div>

      {(research?.tools || []).some((t) => t.used) && (
        <div>
          <div className="mb-2 text-[12px] font-medium text-[#334155]">本轮用到的 GitHub 项目</div>
          <ul className="space-y-1.5">
            {research.tools.filter((t) => t.used).map((t) => (
              <li key={t.id} className="text-[12px] leading-relaxed text-[#475569]">
                <a href={t.repo} target="_blank" rel="noreferrer" className="text-primary hover:underline">{t.name}</a>
                <span className="text-[#94a3b8]"> · {t.use}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
