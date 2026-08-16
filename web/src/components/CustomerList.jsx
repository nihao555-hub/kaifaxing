import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal, Plus, ChevronLeft, ChevronRight, Database } from 'lucide-react';
import { Avatar, StatusBadge } from './common.jsx';

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'uncontacted', label: '未联系' },
  { key: 'following', label: '跟进中' },
  { key: 'replied', label: '已回复' },
];

function formatDate(d) {
  if (!d) return '';
  const [, m, day] = d.split('-');
  return `${Number(m)}月${Number(day)}日`;
}

// 中间客户名单栏
export default function CustomerList({ customers, total, selectedId, onSelect, onAdd, onImportRfq }) {
  const [tab, setTab] = useState('all');
  const [keyword, setKeyword] = useState('');

  const counts = useMemo(() => {
    const c = { all: customers.length, uncontacted: 0, following: 0, replied: 0 };
    for (const cu of customers) c[cu.status] = (c[cu.status] || 0) + 1;
    return c;
  }, [customers]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return customers.filter(
      (c) =>
        (tab === 'all' || c.status === tab) &&
        (!kw || c.name.toLowerCase().includes(kw) || (c.company || '').toLowerCase().includes(kw))
    );
  }, [customers, tab, keyword]);

  return (
    <section className="flex w-[272px] shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* 标题 */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <h2 className="text-[15px] font-semibold text-slate-800">客户名单</h2>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
          {total ?? counts.all}
        </span>
      </div>

      {/* 搜索 + 筛选 + 新增 */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <div className="flex h-8 flex-1 items-center gap-1.5 rounded-lg bg-slate-100 px-2.5">
          <Search size={14} className="text-slate-400" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索客户名称或公司"
            className="w-full bg-transparent text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
        <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
          <SlidersHorizontal size={14} />
        </button>
        <button
          onClick={onImportRfq}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          title="从公开 RFQ 导入"
        >
          <Database size={14} />
        </button>
        <button
          onClick={onAdd}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-sm shadow-primary/30 hover:bg-blue-600"
          title="添加客户"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* 状态 Tabs */}
      <div className="flex items-center gap-4 border-b border-slate-100 px-4 text-xs">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative flex items-center gap-1 pb-2 ${
              tab === t.key ? 'font-medium text-primary' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            <span className={tab === t.key ? 'text-primary/70' : 'text-slate-400'}>
              {counts[t.key] ?? 0}
            </span>
            {tab === t.key && (
              <span className="absolute right-0 -bottom-px left-0 h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* 客户卡片列表 */}
      <div className="thin-scroll flex-1 overflow-y-auto px-2 py-2">
        {filtered.map((c) => {
          const active = c.id === selectedId;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`mb-1 flex w-full items-start gap-2.5 rounded-xl px-2.5 py-3 text-left transition-colors ${
                active ? 'bg-primary-light' : 'hover:bg-slate-50'
              }`}
            >
              <Avatar name={c.name} size={38} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-slate-800">{c.name}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-slate-400">{c.company}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {formatDate(c.lastActivity)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="py-10 text-center text-xs text-slate-400">没有符合条件的客户</div>
        )}
      </div>

      {/* 分页（视觉与设计稿一致） */}
      <div className="flex items-center justify-center gap-1.5 border-t border-slate-100 py-3">
        <button className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
          <ChevronLeft size={14} />
        </button>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={`h-7 w-7 rounded-lg text-xs ${
              n === 1
                ? 'bg-primary font-medium text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {n}
          </button>
        ))}
        <button className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
          <ChevronRight size={14} />
        </button>
      </div>
    </section>
  );
}
