import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Mail,
  Globe,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import { Spinner } from './common.jsx';

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

const FLAGS = {
  英国: '🇬🇧', UK: '🇬🇧', GB: '🇬🇧', 'United Kingdom': '🇬🇧',
  美国: '🇺🇸', US: '🇺🇸', USA: '🇺🇸', 'United States': '🇺🇸',
  德国: '🇩🇪', DE: '🇩🇪', Germany: '🇩🇪',
  荷兰: '🇳🇱', Netherlands: '🇳🇱', NL: '🇳🇱',
  法国: '🇫🇷', FR: '🇫🇷', France: '🇫🇷',
  印度: '🇮🇳', IN: '🇮🇳', India: '🇮🇳',
  中国: '🇨🇳', CN: '🇨🇳', China: '🇨🇳',
  波兰: '🇵🇱', PL: '🇵🇱', Poland: '🇵🇱',
  西班牙: '🇪🇸', ES: '🇪🇸', Spain: '🇪🇸',
  意大利: '🇮🇹', IT: '🇮🇹', Italy: '🇮🇹',
  芬兰: '🇫🇮', FI: '🇫🇮', Finland: '🇫🇮',
  澳大利亚: '🇦🇺', AU: '🇦🇺', Australia: '🇦🇺',
  Indonesia: '🇮🇩', Kenya: '🇰🇪',
};

function flagOf(country) {
  return FLAGS[country] || '🌐';
}

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

function FilterGroup({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-100 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 text-[12px] font-medium text-slate-700"
      >
        {title}
        <ChevronDown size={13} className={`text-slate-400 transition ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="mt-1.5 space-y-0.5 px-3">{children}</div>}
    </div>
  );
}

function CheckRow({ checked, onChange, label, count }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-0.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-primary" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && <span className="shrink-0 text-[11px] text-slate-400">{count.toLocaleString()}</span>}
    </label>
  );
}

function ResearchDot({ done }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${done ? 'bg-emerald-500' : 'bg-slate-300'}`} />
      {done ? '已背调' : '未背调'}
    </span>
  );
}

export default function LeadsPage({ onGoOutreach }) {
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const [sources, setSources] = useState([]);
  const [countries, setCountries] = useState([]);
  const [qualities, setQualities] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [researches, setResearches] = useState([]);
  const [moreCountries, setMoreCountries] = useState(false);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({ sources: {}, countries: {}, total: 0, needEmail: 0, hasEmail: 0, researched: 0 });
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

  const query = useMemo(() => {
    const contactFromTab = tab === 'need_email' ? 'missing' : tab === 'has_email' ? 'found' : '';
    const contactFromFilter = contacts.length === 1 ? contacts[0] : '';
    const quality = qualities.length === 1 ? qualities[0] : '';
    const research = researches.length === 1 ? researches[0] : '';
    return {
      q,
      source: sources.join(','),
      country: countries.join(','),
      contact: contactFromTab || contactFromFilter,
      quality,
      research,
      today: tab === 'today',
      limit,
      offset: page * limit,
    };
  }, [q, tab, sources, countries, qualities, contacts, researches, limit, page]);

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
  const sourceEntries = useMemo(
    () => Object.entries(facets.sources || {}).sort((a, b) => b[1] - a[1]),
    [facets.sources]
  );
  const countryEntries = useMemo(
    () => Object.entries(facets.countries || {}).sort((a, b) => b[1] - a[1]),
    [facets.countries]
  );
  const visibleCountries = moreCountries ? countryEntries : countryEntries.slice(0, 8);

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
      if (selectedId === id || !selectedId) {
        setSelectedId(id);
        setDetail(data);
        setPickedEmail(data.research?.emails?.[0]?.email || '');
        setDrawerOpen(true);
        setDrawerTab('research');
      }
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
      setOkMsg('已录入开发信名单，可到开发信页监控 Agent');
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

  const resetFilters = () => {
    setSources([]);
    setCountries([]);
    setQualities([]);
    setContacts([]);
    setResearches([]);
    setPage(0);
  };

  const submitSearch = () => {
    setPage(0);
    setQ(draftQ.trim());
  };

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
    <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f5f7fa]">
      <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="text-[16px] font-semibold text-slate-800">询盘获客</h1>
            <p className="truncate text-[12px] text-slate-400">
              每日 {String(pipeline?.dailyHour ?? 7).padStart(2, '0')}:00 自动更新
              <span className="mx-1.5 text-slate-200">·</span>
              今日新增 {(pipeline?.todayNew ?? facets.todayNew ?? 0).toLocaleString()}
              {pipeline?.lastDailyAt ? (
                <>
                  <span className="mx-1.5 text-slate-200">·</span>
                  上次同步 {formatTime(pipeline.lastDailyAt)}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              className="h-8 rounded border border-slate-200 bg-white px-3 text-[12px] text-slate-600 hover:bg-slate-50"
            >
              同步记录
            </button>
            <button
              type="button"
              onClick={syncToday}
              disabled={syncing || pipeline?.syncStatus === 'running'}
              className="flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-[12px] font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {syncing || pipeline?.syncStatus === 'running' ? <Spinner className="h-3! w-3!" /> : <RefreshCw size={13} />}
              立即同步
            </button>
          </div>
        </div>

        {showLog && pipeline && (
          <div className="mt-2 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-500">
            北京时间 {pipeline.today}。上次同步 {formatTime(pipeline.lastDailyAt)}
            {pipeline.lastSync ? `，抓到 ${pipeline.lastSync.fetched} / 新入库 ${pipeline.lastSync.createdCount}` : ''}
            。队列 {pipeline.queue} · 今日已背调 {pipeline.researchedToday} · 自动写入邮箱 {pipeline.appliedToday}
            {pipeline.researchingId ? ' · 正在背调…' : ''}
            {pipeline.lastError ? ` · ${pipeline.lastError}` : ''}
          </div>
        )}

        <form
          className="mt-3 flex h-10 overflow-hidden rounded border border-slate-200 bg-white"
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch();
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
            <Search size={15} className="shrink-0 text-slate-400" />
            <input
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              placeholder="输入产品词、公司名或询盘摘要，如 cordless drill"
              className="h-full w-full bg-transparent text-[13px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <button type="submit" className="h-full w-[88px] shrink-0 bg-primary text-[13px] font-medium text-white hover:bg-blue-600">
            搜索
          </button>
        </form>

        <div className="mt-1 flex items-end gap-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setPage(0);
                setChecked([]);
              }}
              className={`relative h-9 text-[13px] ${
                tab === t.key ? 'font-medium text-primary' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
              {t.key === 'today' && (pipeline?.todayNew || 0) > 0 && (
                <span className="ml-1 text-[11px] text-slate-400">{pipeline.todayNew}</span>
              )}
              {tab === t.key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
            </button>
          ))}
        </div>
      </header>

      {(err || okMsg) && (
        <div className="shrink-0 px-5 pt-2">
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

      <div className="flex min-h-0 flex-1">
        <aside className="thin-scroll w-[220px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
          <div className="flex h-10 items-center justify-between border-b border-slate-100 px-3">
            <span className="text-[12px] font-medium text-slate-700">筛选条件</span>
            <button type="button" onClick={resetFilters} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-primary" title="重置">
              <RotateCcw size={11} />
              重置
            </button>
          </div>

          <FilterGroup title="询盘来源">
            {sourceEntries.map(([name, count]) => (
              <CheckRow
                key={name}
                checked={sources.includes(name)}
                onChange={() => {
                  setPage(0);
                  setSources((cur) => toggleValue(cur, name));
                }}
                label={name}
                count={count}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="国家/地区">
            {visibleCountries.map(([name, count]) => (
              <CheckRow
                key={name}
                checked={countries.includes(name)}
                onChange={() => {
                  setPage(0);
                  setCountries((cur) => toggleValue(cur, name));
                }}
                label={`${flagOf(name)} ${name}`}
                count={count}
              />
            ))}
            {countryEntries.length > 8 && (
              <button
                type="button"
                onClick={() => setMoreCountries((v) => !v)}
                className="pt-1 text-[11px] text-primary hover:underline"
              >
                {moreCountries ? '收起' : `更多 ${countryEntries.length - 8} 个国家`}
              </button>
            )}
          </FilterGroup>

          <FilterGroup title="线索类型">
            <CheckRow
              checked={qualities.includes('company')}
              onChange={() => {
                setPage(0);
                setQualities((cur) => toggleValue(cur, 'company'));
              }}
              label="公司名"
            />
            <CheckRow
              checked={qualities.includes('person')}
              onChange={() => {
                setPage(0);
                setQualities((cur) => toggleValue(cur, 'person'));
              }}
              label="个人昵称"
            />
          </FilterGroup>

          {tab !== 'need_email' && tab !== 'has_email' && (
            <FilterGroup title="联系方式">
              <CheckRow
                checked={contacts.includes('missing')}
                onChange={() => {
                  setPage(0);
                  setContacts((cur) => toggleValue(cur, 'missing'));
                }}
                label="待挖邮箱"
                count={facets.needEmail}
              />
              <CheckRow
                checked={contacts.includes('found')}
                onChange={() => {
                  setPage(0);
                  setContacts((cur) => toggleValue(cur, 'found'));
                }}
                label="已有邮箱"
                count={facets.hasEmail}
              />
            </FilterGroup>
          )}

          <FilterGroup title="背调状态">
            <CheckRow
              checked={researches.includes('none')}
              onChange={() => {
                setPage(0);
                setResearches((cur) => toggleValue(cur, 'none'));
              }}
              label="未背调"
            />
            <CheckRow
              checked={researches.includes('done')}
              onChange={() => {
                setPage(0);
                setResearches((cur) => toggleValue(cur, 'done'));
              }}
              label="已背调"
              count={facets.researched}
            />
          </FilterGroup>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-white">
          {checked.length > 0 && (
            <div className="flex h-9 items-center gap-3 border-b border-slate-100 bg-[#f7f9fc] px-3 text-[12px] text-slate-600">
              <span>已选 {checked.length} 条</span>
              <button type="button" onClick={batchResearch} disabled={busy} className="text-primary hover:underline disabled:opacity-50">
                批量挖邮箱
              </button>
              <button type="button" onClick={() => setChecked([])} className="text-slate-400 hover:text-slate-600">
                取消选择
              </button>
            </div>
          )}

          <div className="thin-scroll min-h-0 flex-1 overflow-auto">
            <table className="w-full table-fixed text-left text-[12px]">
              <thead className="sticky top-0 z-10 bg-[#fafbfc] text-[12px] font-medium text-slate-400">
                <tr className="border-b border-slate-200">
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) => setChecked(e.target.checked ? rows.map((r) => r.id) : [])}
                      className="accent-primary"
                    />
                  </th>
                  <th className="w-[18%] px-2 py-2">公司/买家</th>
                  <th className="w-[10%] px-2 py-2">国家</th>
                  <th className="px-2 py-2">询盘摘要</th>
                  <th className="w-[14%] px-2 py-2">来源</th>
                  <th className="w-[16%] px-2 py-2">联系人</th>
                  <th className="w-[9%] px-2 py-2">背调</th>
                  <th className="w-[12%] px-2 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const active = c.id === selectedId && drawerOpen;
                  return (
                    <tr key={c.id} className={`border-b border-slate-100 ${active ? 'bg-primary-light' : 'hover:bg-[#f7f9fc]'}`}>
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={checked.includes(c.id)}
                          onChange={() => setChecked((cur) => toggleValue(cur, c.id))}
                          className="accent-primary"
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <button
                          type="button"
                          onClick={() => openDrawer(c.id, 'basic')}
                          className="block w-full truncate text-left font-medium text-primary hover:underline"
                          title={companyOf(c)}
                        >
                          {companyOf(c)}
                        </button>
                      </td>
                      <td className="px-2 py-2.5 text-slate-600">
                        <span className="mr-1">{flagOf(c.country)}</span>
                        <span className="truncate">{c.country || '—'}</span>
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="line-clamp-2 leading-5 text-slate-500" title={snippetOf(c)}>
                          {snippetOf(c)}
                        </span>
                      </td>
                      <td className="truncate px-2 py-2.5 text-slate-500">{c.source || '—'}</td>
                      <td className="truncate px-2 py-2.5">
                        {c.email ? <span className="text-slate-700">{c.email}</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-2.5">
                        <ResearchDot done={c.research?.status === 'done'} />
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => runResearch(c.id)}
                            disabled={busy}
                            className="text-primary hover:underline disabled:opacity-40"
                          >
                            挖邮箱
                          </button>
                          <button type="button" onClick={() => openDrawer(c.id, 'research')} className="text-slate-500 hover:underline">
                            详情
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-20 text-center text-[13px] text-slate-400">
                      没有符合条件的询盘，试试换关键词或放宽左侧筛选
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {loading && (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-slate-400">
                <Spinner /> 加载询盘
              </div>
            )}
          </div>

          <div className="flex h-11 shrink-0 items-center justify-between border-t border-slate-200 px-3 text-[12px] text-slate-500">
            <span>共 {total.toLocaleString()} 条</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-400 hover:bg-slate-50 disabled:opacity-30"
                >
                  <ChevronLeft size={14} />
                </button>
                {pageNumbers(page, pages).map((item, i) =>
                  item === '…' ? (
                    <span key={`e${i}`} className="px-1 text-slate-300">…</span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPage(item)}
                      className={`h-7 min-w-7 rounded px-1.5 ${
                        page === item ? 'bg-primary text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
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
                  className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-400 hover:bg-slate-50 disabled:opacity-30"
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
                className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[12px]"
              >
                <option value={20}>20 条/页</option>
                <option value={50}>50 条/页</option>
                <option value={100}>100 条/页</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {drawerOpen && (
        <div className="absolute inset-0 z-20 flex justify-end bg-slate-900/20" onClick={() => setDrawerOpen(false)}>
          <aside
            className="flex h-full w-[440px] flex-col border-l border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <div className="truncate text-[16px] font-semibold text-slate-800">{companyOf(customer || {})}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
                  <span>{flagOf(customer?.country)} {customer?.country || '国家未知'}</span>
                  {customer?.sourceUrl ? (
                    <a href={customer.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      {customer.source || '原始询盘'} <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span>{customer?.source || '公开询盘'}</span>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>

            <div className="flex shrink-0 gap-5 border-b border-slate-100 px-5">
              {DRAWER_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setDrawerTab(t.key)}
                  className={`relative h-10 text-[13px] ${drawerTab === t.key ? 'font-medium text-primary' : 'text-slate-500'}`}
                >
                  {t.label}
                  {drawerTab === t.key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
                </button>
              ))}
            </div>

            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {!customer ? (
                <div className="py-16 text-center text-[12px] text-slate-400">加载详情…</div>
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

            <div className="flex shrink-0 gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => customer && runResearch(customer.id)}
                disabled={busy || !customer}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded border border-primary text-[13px] font-medium text-primary hover:bg-primary-light disabled:opacity-40"
              >
                {busy ? <Spinner className="h-3! w-3!" /> : <Mail size={13} />}
                {research?.status === 'done' ? '重新挖邮箱' : '挖邮箱'}
              </button>
              <button
                type="button"
                onClick={applyContact}
                disabled={busy || !pickedEmail}
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
      <dt className="w-16 shrink-0 text-slate-400">{label}</dt>
      <dd className="min-w-0 break-all text-slate-700">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function DrawerBody({ tab, customer, research, pickedEmail, setPickedEmail }) {
  if (tab === 'basic') {
    return (
      <dl>
        <InfoRow label="公司" value={customer.company || customer.name} />
        <InfoRow label="买家" value={customer.buyer || customer.name} />
        <InfoRow label="国家" value={customer.country} />
        <InfoRow label="来源" value={customer.source} />
        <InfoRow label="官网" value={research?.website || customer.website} href={research?.website || customer.website} />
        <InfoRow label="行业" value={research?.facts?.find((f) => /行业|industry/i.test(f.label))?.value || customer.industry} />
        <InfoRow label="法人名" value={research?.legalName} />
        {(research?.facts || []).slice(0, 8).map((f) => (
          <InfoRow key={`${f.label}-${f.value}`} label={f.label} value={f.value} />
        ))}
      </dl>
    );
  }

  if (tab === 'rfq') {
    return (
      <div className="space-y-3 text-[12px] leading-relaxed text-slate-600">
        <div>
          <div className="mb-1 text-slate-400">询盘摘要</div>
          <p>{snippetOf(customer)}</p>
        </div>
        {customer.rfq?.title && (
          <div>
            <div className="mb-1 text-slate-400">标题</div>
            <p>{customer.rfq.title}</p>
          </div>
        )}
        {customer.sourceUrl && (
          <a href={customer.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            打开原始询盘 <ExternalLink size={12} />
          </a>
        )}
        {customer.ingestedAt && <div className="text-slate-400">入库时间 {formatTime(customer.ingestedAt)}</div>}
      </div>
    );
  }

  if (tab === 'contacts') {
    const emails = research?.emails || (customer.email ? [{ email: customer.email, role: '已写入' }] : []);
    return (
      <div className="space-y-2">
        {emails.length ? emails.map((e) => (
          <label
            key={e.email}
            className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 ${
              pickedEmail === e.email ? 'border-primary bg-primary-light' : 'border-slate-200'
            }`}
          >
            <input type="radio" name="email" checked={pickedEmail === e.email} onChange={() => setPickedEmail(e.email)} />
            <span className="text-[12px] text-slate-700">{e.email}</span>
            <span className="ml-auto text-[10px] text-slate-400">{e.role || '公开邮箱'}</span>
          </label>
        )) : (
          <p className="text-[12px] text-slate-400">还没有可核验的公开角色邮箱，先点底部「挖邮箱」。</p>
        )}
        {research?.phones?.length > 0 && (
          <div className="pt-2 text-[12px] text-slate-600">公开电话：{research.phones.join(' · ')}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {research?.status === 'running' && <p className="text-[12px] text-slate-500">正在查 Wikidata / GLEIF / 官网联系页…</p>}
      {research?.status === 'failed' && <p className="text-[12px] text-rose-500">{research.error || '背调失败'}</p>}
      {!research?.status && (
        <p className="text-[12px] leading-relaxed text-slate-500">
          还没做过公开背调。点底部「挖邮箱」，只查 Wikidata / GLEIF / 官网联系页上的角色邮箱，不扒私人邮箱。
        </p>
      )}

      {research?.status === 'done' && (
        <>
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

          {research.brief && <p className="text-[12px] leading-relaxed text-slate-600">{research.brief}</p>}

          {research.website && (
            <div className="flex items-start gap-2 text-[12px] text-slate-600">
              <Globe size={14} className="mt-0.5 text-slate-400" />
              <a href={research.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {research.website}
              </a>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[12px] font-medium text-slate-700">公开角色邮箱</div>
            {research.emails?.length ? (
              <div className="space-y-1.5">
                {research.emails.map((e) => (
                  <label
                    key={e.email}
                    className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 ${
                      pickedEmail === e.email ? 'border-primary bg-primary-light' : 'border-slate-200'
                    }`}
                  >
                    <input type="radio" name="email-research" checked={pickedEmail === e.email} onChange={() => setPickedEmail(e.email)} />
                    <span className="text-[12px] text-slate-700">{e.email}</span>
                    <span className="ml-auto text-[10px] text-slate-400">{e.role}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[12px] leading-relaxed text-slate-500">
                这次没有拿到可验证的公开邮箱。大公司常用联系表单；阿里公开 RFQ 往往只有昵称。
              </p>
            )}
          </div>

          {research.outreachAdvice && (
            <div className="rounded bg-[#f7f9fc] p-3 text-[12px] leading-relaxed text-slate-600">{research.outreachAdvice}</div>
          )}
          {research.risks?.length > 0 && (
            <div className="flex gap-2 text-[12px] text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{research.risks.join('；')}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
