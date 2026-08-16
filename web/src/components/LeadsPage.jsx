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

function gradeStyle(grade) {
  if (grade === 'A') return 'bg-emerald-50 text-emerald-700';
  if (grade === 'B') return 'bg-amber-50 text-amber-700';
  if (grade === 'C') return 'bg-rose-50 text-rose-600';
  return 'bg-[#f1f5f9] text-[#94a3b8]';
}

function ResearchStatus({ status, grade }) {
  if (status === 'running') return <span className="text-[12px] text-primary">背调中</span>;
  if (status === 'failed') return <span className="text-[12px] text-rose-500">失败</span>;
  if (status === 'done' && grade) {
    return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${gradeStyle(grade)}`}>{grade}级</span>;
  }
  if (status === 'done') return <span className="text-[12px] text-emerald-600">已背调</span>;
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
  const [postedOn, setPostedOn] = useState('');
  const [category, setCategory] = useState('');
  const [categoryQ, setCategoryQ] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({ countries: {}, dates: {}, categories: {}, total: 0, needEmail: 0, hasEmail: 0, researched: 0 });
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
    postedOn,
    category,
    today: tab === 'today',
    limit,
    offset: page * limit,
  }), [q, tab, selectedNames, quality, researchFilter, postedOn, category, limit, page]);

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

  const identifyCompany = async (payload) => {
    if (!selectedId) return;
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const data = await api.identifyLead(selectedId, payload);
      setDetail(data);
      setPickedEmail(data.research?.emails?.[0]?.email || '');
      setDrawerTab('research');
      await load();
      setOkMsg(`已按「${data.customer?.company}」重新背调`);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
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
    if (research?.kyb?.grade === 'C' || (research?.kyb?.sanctions || []).length) {
      setErr(research.kyb?.nextAction || '分级为停，不能录入开发信');
      return;
    }
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
    setPostedOn('');
    setCategory('');
    setCategoryQ('');
    setPage(0);
  };

  const countrySummary = useMemo(() => {
    if (!countryKeys.length) return '';
    const first = countryGroups.find((g) => g.key === countryKeys[0])?.label || '';
    return countryKeys.length === 1 ? first : `${first} 等${countryKeys.length}国`;
  }, [countryKeys, countryGroups]);
  const qualityLabel = quality === 'company' ? '公司名'
    : quality === 'person' ? '个人昵称'
      : quality === 'auto' ? '可自动背调'
        : quality === 'import' ? '需补主体' : '';
  const researchLabel = researchFilter === 'done' ? '已背调' : researchFilter === 'none' ? '未背调' : '';
  const dateEntries = useMemo(
    () => Object.entries(facets.dates || {}).sort((a, b) => String(b[0]).localeCompare(String(a[0]))),
    [facets.dates]
  );
  const categoryEntries = useMemo(() => {
    const rows = Object.entries(facets.categories || {}).sort((a, b) => b[1] - a[1]);
    const kw = categoryQ.trim().toLowerCase();
    return kw ? rows.filter(([name]) => name.toLowerCase().includes(kw)) : rows;
  }, [facets.categories, categoryQ]);
  const hasFilters = countryKeys.length > 0 || quality || researchFilter || postedOn || category;

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
              符合要求的背调 = 主体已核 + 官网 + 角色邮箱 + 未制裁
              <span className="mx-1.5 text-[#e2e8f0]">·</span>
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

        <div className="mt-3 grid gap-2 rounded-lg border border-[#e8edf4] bg-[#f8fafc] px-3 py-2.5 text-[11px] leading-relaxed text-[#64748b] sm:grid-cols-3">
          <div>
            <span className="font-medium text-[#334155]">1. 可自动背调</span>
            {' '}
            政府招标、写出 Ltd/LLC 的询盘：公开库 + 搜索公式挖官网角色邮箱。
          </div>
          <div>
            <span className="font-medium text-[#334155]">2. 询盘指纹</span>
            {' '}
            有型号/SKU 时搜同款公开询盘，不搜买家昵称。命中公司名再核主体。
          </div>
          <div>
            <span className="font-medium text-[#334155]">3. 需补主体</span>
            {' '}
            只有 Linda N 这种：导入阿里后台报价后的公司名，或填「补主体」。
          </div>
        </div>

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
            <MenuOption active={quality === 'auto'} label="可自动背调" onClick={() => { setQuality('auto'); setPage(0); }} />
            <MenuOption active={quality === 'import'} label="需补主体" onClick={() => { setQuality('import'); setPage(0); }} />
            <MenuOption active={quality === 'company'} label="公司名" onClick={() => { setQuality('company'); setPage(0); }} />
            <MenuOption active={quality === 'person'} label="个人昵称" onClick={() => { setQuality('person'); setPage(0); }} />
          </FilterMenu>

          <FilterMenu label="发布日期" summary={postedOn} active={Boolean(postedOn)} width={240}>
            <MenuOption active={!postedOn} label="全部日期" onClick={() => { setPostedOn(''); setPage(0); }} />
            <div className="thin-scroll max-h-64 overflow-y-auto">
              {dateEntries.slice(0, 40).map(([day, count]) => (
                <MenuOption
                  key={day}
                  active={postedOn === day}
                  label={day}
                  count={count}
                  onClick={() => { setPostedOn(day); setPage(0); }}
                />
              ))}
            </div>
          </FilterMenu>

          <FilterMenu label="采购品类" summary={category} active={Boolean(category)} width={280}>
            <div className="px-2 py-1.5">
              <div className="flex h-8 items-center gap-1.5 rounded border border-[#e2e8f0] bg-[#f8fafc] px-2">
                <Search size={12} className="text-[#94a3b8]" />
                <input
                  value={categoryQ}
                  onChange={(e) => setCategoryQ(e.target.value)}
                  placeholder="搜索品类，如 Electronics"
                  className="h-full w-full bg-transparent text-[12px] text-[#334155] placeholder:text-[#94a3b8] focus:outline-none"
                />
              </div>
            </div>
            <MenuOption active={!category} label="全部品类" onClick={() => { setCategory(''); setPage(0); }} />
            <div className="thin-scroll max-h-64 overflow-y-auto">
              {categoryEntries.slice(0, 40).map(([name, count]) => (
                <MenuOption
                  key={name}
                  active={category === name}
                  label={name}
                  count={count}
                  onClick={() => { setCategory(name); setPage(0); }}
                />
              ))}
            </div>
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
                  <th className="w-[10%] px-3 py-2.5">国家</th>
                  <th className="w-[9%] px-3 py-2.5">日期</th>
                  <th className="w-[10%] px-3 py-2.5">品类</th>
                  <th className="px-3 py-2.5">采购需求</th>
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
                      <td className="px-3 py-3 text-[#64748b]">{c.postedDate || (c.postedAt || '').slice(0, 10) || '—'}</td>
                      <td className="truncate px-3 py-3 text-[#64748b]" title={c.categoryName || ''}>{c.categoryName || '—'}</td>
                      <td className="px-3 py-3">
                        <span className="line-clamp-2 leading-5 text-[#64748b]" title={c.product || snippetOf(c)}>
                          {c.product || snippetOf(c)}
                        </span>
                      </td>
                      <td className="truncate px-3 py-3">
                        {c.email ? <span className="text-primary">{c.email}</span> : <span className="text-[#cbd5e1]">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <ResearchStatus status={c.research?.status} grade={c.research?.grade || c.research?.kyb?.grade} />
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
                    <td colSpan={9} className="px-6 py-20 text-center text-[13px] text-[#94a3b8]">
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
                  searchLinks={detail?.searchLinks || research?.searchLinks || []}
                  imageSearchLinks={detail?.imageSearchLinks || []}
                  googleReady={Boolean(detail?.searchStatus?.ready)}
                  pickedEmail={pickedEmail}
                  setPickedEmail={setPickedEmail}
                  onIdentify={identifyCompany}
                  identifying={busy}
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
                disabled={busy || !customer || research?.kyb?.grade === 'C' || (research?.kyb?.sanctions || []).length > 0}
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
  const search = (research?.searchPages || []).length > 0
    || (research?.facts || []).some((f) => f.source === '搜索公式');
  const sanctionsOk = research?.status === 'done'
    && research?.kyb?.screened
    && !(research?.kyb?.sanctions || []).length;
  const trade = (research?.kyb?.traces || []).length > 0 || procurement;
  return [
    { label: '公司官网', ok: website },
    { label: '社交媒体', ok: social },
    { label: '工商信息', ok: registry },
    { label: '招投标/采购记录', ok: trade },
    { label: '搜索公式', ok: search },
    { label: '制裁筛查', ok: sanctionsOk },
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
            {e.source || (e.role === 'info' || e.role === 'enquiry' || e.role === 'contact' ? '官网' : (e.role || '官网'))}
          </span>
          <span className="ml-auto text-[10px] text-emerald-600">可用</span>
        </label>
      ))}
    </div>
  );
}

function IdentifyForm({ customer, onSubmit, busy = false }) {
  const [company, setCompany] = useState('');
  const [regNo, setRegNo] = useState('');
  const [website, setWebsite] = useState('');
  return (
    <form
      className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.({ company, regNo, website });
      }}
    >
      <div className="text-[12px] font-medium text-[#334155]">补主体后再背调</div>
      <p className="text-[11px] leading-relaxed text-[#64748b]">
        公开列表只有「{customer?.buyerAlias || customer?.company || customer?.name || '昵称'}」，没有公司名和邮箱。
        邦阅/米课那套「领英对人、Lusha 挖私人邮箱、猜 Gmail」这里不做。
        能用的只有：正文里的法定名、型号交叉检索到的同款询盘、公开缩略图里的 logo、阿里后台导出/报价后的公司名。
      </p>
      {customer?.sourceUrl && (
        <a href={customer.sourceUrl} target="_blank" rel="noreferrer" className="inline-block text-[11px] text-primary hover:underline">
          打开公开询盘页（详情附件在登录墙后，不爬）
        </a>
      )}
      <input
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        placeholder="法定公司名，如 NMG TECHNICAL SERVICE L.L.C"
        className="w-full rounded border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-primary"
      />
      <input
        value={regNo}
        onChange={(e) => setRegNo(e.target.value)}
        placeholder="登记号（可选）"
        className="w-full rounded border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-primary"
      />
      <input
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        placeholder="官网（可选）"
        className="w-full rounded border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-primary"
      />
      <button
        type="submit"
        disabled={busy || !company.trim()}
        className="h-8 rounded bg-primary px-3 text-[12px] text-white disabled:opacity-40"
      >
        {busy ? '正在按新主体背调…' : '补主体并背调'}
      </button>
    </form>
  );
}

function GoogleSearchLinks({ links, googleReady = false }) {
  if (!links?.length) return null;
  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-[#334155]">{googleReady ? '谷歌公式（已接官方 API）' : '用谷歌搜（浏览器打开）'}</div>
      <p className="text-[11px] leading-relaxed text-[#94a3b8]">
        {googleReady
          ? '背调已走谷歌官方 JSON 接口。下面公式仍可在浏览器里核对；核到官网角色邮箱后再点「挖邮箱」或手工填入。'
          : '服务器抓谷歌会被验证码挡住。到「设置」填 Custom Search 的 Key + CX 即可自动跑。同一套公式也可先在浏览器里打开。'}
      </p>
      <ul className="space-y-1.5">
        {links.map((item) => (
          <li key={item.query} className="rounded border border-[#e2e8f0] px-2.5 py-2">
            <div className="truncate text-[11px] text-[#475569]">{item.query}</div>
            <div className="mt-1 flex gap-3 text-[11px]">
              <a href={item.google} target="_blank" rel="noreferrer" className="text-primary hover:underline">谷歌</a>
              <a href={item.bing} target="_blank" rel="noreferrer" className="text-primary hover:underline">必应</a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ImageSearchLinks({ links, haveAnnexes = false }) {
  if (!links?.length && !haveAnnexes) return null;
  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-[#334155]">公开缩略图</div>
      <p className="text-[11px] leading-relaxed text-[#94a3b8]">
        列表页大约四分之一有缩略图，多半是产品图，反查到的是同类商品不是买家公司。
        只有图上有 logo / 铭牌时才有用。附件标记在登录墙后，不下载。
      </p>
      {haveAnnexes && (
        <p className="text-[11px] text-amber-700">这条列表标记有附件，但附件不在公开列表里。</p>
      )}
      {links?.length > 0 && (
        <div className="flex flex-wrap gap-3 text-[11px]">
          {links.map((item) => (
            <a key={item.key || item.url} href={item.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function DrawerBody({ tab, customer, research, searchLinks = [], imageSearchLinks = [], googleReady = false, pickedEmail, setPickedEmail, onIdentify, identifying = false }) {
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
        <InfoRow label="发布日期" value={customer.postedDate || (customer.postedAt || '').slice(0, 10)} />
        <InfoRow label="采购品类" value={customer.categoryName} />
        <InfoRow label="采购产品" value={customer.product} />
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
        {(customer.postedDate || customer.categoryName || customer.product) && (
          <div className="text-[#94a3b8]">
            {[customer.postedDate, customer.categoryName, customer.product].filter(Boolean).join(' · ')}
          </div>
        )}
        {customer.ingestedAt && <div className="text-[#94a3b8]">入库时间 {formatTime(customer.ingestedAt)}</div>}
        {customer.imageUrl && (
          <img src={customer.imageUrl} alt="" className="mt-2 max-h-36 rounded border border-[#e8edf4] object-contain" />
        )}
        <ImageSearchLinks links={imageSearchLinks} haveAnnexes={Boolean(customer.haveAnnexes)} />
      </div>
    );
  }

  if (tab === 'contacts') {
    return (
      <div className="space-y-3">
        {emails.length ? (
          <EmailPick emails={emails} pickedEmail={pickedEmail} setPickedEmail={setPickedEmail} name="email" />
        ) : (
          <p className="text-[12px] text-[#94a3b8]">还没有可核验的公开角色邮箱。背调会用必应/谷歌的 site:域名、info@、联系页公式去挖官网角色邮箱，不会猜私人邮箱。</p>
        )}
        {research?.phones?.length > 0 && (
          <div className="text-[12px] text-[#475569]">公开电话：{research.phones.join(' · ')}</div>
        )}
        <ImageSearchLinks links={imageSearchLinks} haveAnnexes={Boolean(customer.haveAnnexes)} />
        <GoogleSearchLinks links={searchLinks} googleReady={googleReady} />
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

      {(research?.path || customer.researchPath) && (
        <div className="rounded-lg border border-[#e8edf4] bg-[#f8fafc] px-3 py-2.5">
          <div className="text-[12px] font-medium text-[#334155]">
            背调路径 · {(research?.path?.label) || (customer.researchPath === 'import' ? '需补主体' : '可自动背调')}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[#475569]">
            {research?.path?.next || '先确认可核验主体，再查官网角色邮箱。不搜人名、不猜 Gmail。'}
          </p>
          {research?.clues?.fingerprints?.length > 0 && (
            <p className="mt-1 text-[11px] text-[#64748b]">询盘指纹：{research.clues.fingerprints.join(' · ')}</p>
          )}
          {(research?.crosspost?.companies || []).length > 0 && (
            <p className="mt-1 text-[11px] text-[#64748b]">
              交叉检索候选：{research.crosspost.companies.map((x) => x.name).join('；')}
            </p>
          )}
        </div>
      )}

      {research?.kyb?.grade && (
        <div className={`rounded-lg border px-3 py-2.5 ${
          research.kyb.grade === 'A' ? 'border-emerald-200 bg-emerald-50' : research.kyb.grade === 'B' ? 'border-amber-200 bg-amber-50' : 'border-rose-200 bg-rose-50'
        }`}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${gradeStyle(research.kyb.grade)}`}>{research.kyb.grade}级 · {research.kyb.label}</span>
          </div>
          <p className="text-[12px] leading-relaxed text-[#334155]">{research.kyb.nextAction || research.nextAction}</p>
          {research.kyb.needRegNo && (
            <p className="mt-1 text-[12px] text-[#64748b]">请对方提供法定全称、登记号、付款主体后再查。</p>
          )}
        </div>
      )}

      {research?.kyb?.grade === 'C' && research?.kyb?.needRegNo && (
        <IdentifyForm customer={customer} onSubmit={onIdentify} busy={identifying} />
      )}
      <ImageSearchLinks links={imageSearchLinks} haveAnnexes={Boolean(customer.haveAnnexes)} />

      {(research?.kyb?.sanctions || []).length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          制裁名单命中：{research.kyb.sanctions.map((h) => `${h.name}（${h.list}）`).join('；')}
        </div>
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
              ? '官网和搜索公式都没有明文角色邮箱。大公司常用联系表单；只有昵称的询盘核不到公司主体。不会猜私人邮箱。'
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
          <InfoRow label="营业时间" value={factValue(research, /营业时间/)} />
          <InfoRow label="行业" value={industry} />
          <InfoRow label="员工规模" value={size} />
          <InfoRow label="母公司" value={factValue(research, /最终母公司/)} />
          <InfoRow label="登记号" value={factValue(research, /登记号|SIREN|Org\.nr|IČO|CNPJ/)} />
          <InfoRow label="LEI" value={factValue(research, /^LEI$/)} />
          <InfoRow label="搜索官网" value={factValue(research, /搜索官网/)} href={factValue(research, /搜索官网/)} />
          <InfoRow label="下一步" value={research?.nextAction || research?.kyb?.nextAction} />
        </dl>
        {(research?.kyb?.traces || []).length > 0 && (
          <div className="mt-2">
            <div className="mb-1 text-[12px] text-[#94a3b8]">采购痕迹</div>
            <ul className="space-y-1">
              {research.kyb.traces.slice(0, 4).map((t) => (
                <li key={`${t.source}-${t.value}`} className="truncate text-[12px] text-[#475569]">
                  {t.url ? <a href={t.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{t.value}</a> : t.value}
                  <span className="text-[#94a3b8]"> · {t.source}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3">
          <GoogleSearchLinks links={searchLinks} googleReady={googleReady} />
        </div>
        {(research?.searchPages || []).length > 0 && (
          <div className="mt-2">
            <div className="mb-1 text-[12px] text-[#94a3b8]">搜索解析到的公开页</div>
            <ul className="space-y-1">
              {research.searchPages.slice(0, 5).map((url) => (
                <li key={url} className="truncate text-[12px]">
                  <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{url}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
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
