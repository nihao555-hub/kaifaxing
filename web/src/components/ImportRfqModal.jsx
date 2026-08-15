import { useEffect, useState } from 'react';
import { X, Database, Download } from 'lucide-react';
import { api } from '../api.js';
import { Spinner } from './common.jsx';

export default function ImportRfqModal({ onClose, onImported }) {
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState('all');
  const [q, setQ] = useState('power tools');
  const [items, setItems] = useState([]);
  const [reports, setReports] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.rfqSources().then((d) => setSources(d.sources || [])).catch(() => {});
  }, []);

  const search = async () => {
    setErr('');
    setLoading(true);
    try {
      const { items: list, reports: reps } = await api.rfqSearch(source, q);
      setItems(list || []);
      setReports(reps || []);
      setPicked(new Set((list || []).map((x) => x.id)));
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id) => {
    const n = new Set(picked);
    n.has(id) ? n.delete(id) : n.add(id);
    setPicked(n);
  };

  const importPicked = async () => {
    const selected = items.filter((x) => picked.has(x.id));
    if (!selected.length) return;
    const { created } = await api.rfqImport(selected);
    onImported(created);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="fade-in-up flex h-[86vh] w-[860px] max-w-full flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
            <Database size={16} className="text-primary" />
            聚合公开 RFQ / 采购数据源
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="thin-scroll flex-1 overflow-y-auto px-6 py-4">
          <p className="mb-3 text-xs leading-relaxed text-slate-500">
            默认「全部聚合」：一次并行拉取美国、英国、欧盟、世界银行等官方接口，结果去重合并。某个源失败不影响其他源。不爬私人邮箱；没有公开邮箱的线索入库后不会自动发信。
          </p>

          <div className="mb-3 grid grid-cols-2 gap-2">
            {sources.map((s) => (
              <button
                key={s.key}
                disabled={!s.ready && s.key !== 'all'}
                onClick={() => s.ready && setSource(s.key)}
                className={`rounded-xl border p-3 text-left ${
                  source === s.key ? 'border-primary bg-primary-light' : 'border-slate-200'
                } ${s.ready ? '' : 'opacity-50'}`}
              >
                <div className="text-[13px] font-semibold text-slate-800">
                  {s.name}
                  <span className="ml-2 text-[11px] font-normal text-slate-400">
                    {s.region} · {s.auth}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{s.note}</p>
              </button>
            ))}
          </div>

          <div className="mb-3 flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="关键词，如 power tools"
              className="h-9 flex-1 rounded-lg border border-slate-200 px-3 text-xs focus:border-primary focus:outline-none"
            />
            <button
              onClick={search}
              disabled={loading}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {loading ? <Spinner className="h-3! w-3!" /> : <Download size={13} />}
              {source === 'all' ? '聚合拉取' : '拉取公开数据'}
            </button>
          </div>

          {reports.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {reports.map((r) => (
                <span
                  key={r.key}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    r.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                  }`}
                  title={r.error || ''}
                >
                  {r.name} {r.ok ? `${r.count} 条` : '失败'}
                </span>
              ))}
            </div>
          )}

          {err && <p className="mb-2 text-xs text-red-500">{err}</p>}

          <div className="flex flex-col gap-2">
            {items.map((it) => (
              <label key={it.id} className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3">
                <input type="checkbox" checked={picked.has(it.id)} onChange={() => toggle(it.id)} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-slate-800">{it.company || it.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {it.source} · {it.country} {it.state || ''} {it.email ? `· ${it.email}` : '· 无公开邮箱'}
                    {it.amount ? ` · ${Math.round(it.amount).toLocaleString()}` : ''}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{it.painPoints}</p>
                </div>
              </label>
            ))}
            {!loading && items.length === 0 && (
              <div className="py-10 text-center text-xs text-slate-400">
                默认选「全部聚合」，点「聚合拉取」一次拿多个官方源
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3.5">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] text-slate-600">
            取消
          </button>
          <button
            onClick={importPicked}
            disabled={picked.size === 0}
            className="rounded-lg bg-primary px-5 py-2 text-[13px] font-medium text-white disabled:opacity-40"
          >
            导入 {picked.size} 条线索
          </button>
        </div>
      </div>
    </div>
  );
}
