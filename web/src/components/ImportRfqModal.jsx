import { useEffect, useState } from 'react';
import { X, Database, Download } from 'lucide-react';
import { api } from '../api.js';
import { Spinner } from './common.jsx';

const SAMPLE_JSON = `{
  "source": "TendersOnTime",
  "items": [
    {
      "company": "Acme GmbH",
      "name": "Procurement",
      "email": "procurement@acme.example",
      "country": "德国",
      "industry": "Power tools",
      "painPoints": "Need 500 cordless drills for Q4 warehouse rollout",
      "url": "https://example.com/rfq/123"
    }
  ]
}`;

export default function ImportRfqModal({ onClose, onImported }) {
  const [tab, setTab] = useState('government');
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState('all');
  const [q, setQ] = useState('power tools');
  const [items, setItems] = useState([]);
  const [reports, setReports] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ingestText, setIngestText] = useState(SAMPLE_JSON);
  const [ingestMsg, setIngestMsg] = useState('');

  useEffect(() => {
    api.rfqSources().then((d) => setSources(d.sources || [])).catch(() => {});
  }, []);

  const visible = sources.filter((s) => {
    if (tab === 'government') return s.kind === 'aggregate' || s.kind === 'government';
    return s.kind === 'commercial';
  });

  const search = async (key = source) => {
    setErr('');
    setLoading(true);
    try {
      const { items: list, reports: reps } = await api.rfqSearch(key, q);
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

  const ingestJson = async () => {
    setErr('');
    setIngestMsg('');
    try {
      const payload = JSON.parse(ingestText);
      const { created, accepted } = await api.rfqIngest(payload);
      setIngestMsg(`接受 ${accepted} 条，新入库 ${created.length} 条（重复或自己的发件箱已跳过）`);
      if (created.length) onImported(created);
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="fade-in-up flex h-[86vh] w-[860px] max-w-full flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
            <Database size={16} className="text-primary" />
            RFQ 数据源
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-100 px-6 pt-3">
          {[
            { id: 'government', label: '政府招标（已接通）' },
            { id: 'commercial', label: '商业询盘 / 阿里' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setSource(t.id === 'government' ? 'all' : 'alibaba');
                setItems([]);
                setReports([]);
                setErr('');
              }}
              className={`rounded-t-lg px-3 py-2 text-[13px] ${
                tab === t.id ? 'bg-primary-light font-semibold text-primary' : 'text-slate-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="thin-scroll flex-1 overflow-y-auto px-6 py-4">
          {tab === 'government' ? (
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              当前已接通的公开接口几乎都是<strong>政府 / 机构招标</strong>（美国、英国、欧盟、世界银行），不是阿里那种商业买家询盘。
              没有合法免费的「全球所有 RFQ」单一网站；政府侧可用 TendersOnTime、dgMarket 等付费聚合，再用右边商业页的 JSON 导入。
            </p>
          ) : (
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              阿里国际站、中国制造网、环球资源的询盘各自锁在卖家后台，<strong>没有</strong>一个合法免费 API 能扒全球商业 RFQ。
              阿里只走官方 <code>alibaba.icbu.rfq.search</code>；其他付费源把 JSON 贴进来即可。不要爬页面、不要买私人邮箱包。
            </p>
          )}

          <div className="mb-3 grid grid-cols-2 gap-2">
            {visible.map((s) => (
              <button
                key={s.key}
                disabled={!s.ready && s.key !== 'ingest'}
                onClick={() => {
                  if (s.key === 'ingest') return;
                  if (s.ready) setSource(s.key);
                }}
                className={`rounded-xl border p-3 text-left ${
                  source === s.key ? 'border-primary bg-primary-light' : 'border-slate-200'
                } ${s.ready || s.key === 'ingest' ? '' : 'opacity-50'}`}
              >
                <div className="text-[13px] font-semibold text-slate-800">
                  {s.name}
                  <span className="ml-2 text-[11px] font-normal text-slate-400">
                    {s.region} · {s.auth}
                    {s.ready ? '' : ' · 未就绪'}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{s.note}</p>
              </button>
            ))}
          </div>

          {tab === 'commercial' && (
            <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50/70 p-3 text-[11px] leading-relaxed text-amber-800">
              <div className="mb-1 font-semibold">阿里国际站怎么接通</div>
              1. 用国际站卖家账号到开放平台创建应用，申请 <code>alibaba.icbu.rfq.search</code> 权限<br />
              2. 卖家授权拿到 session<br />
              3. 环境变量写入 <code>ALIBABA_APP_KEY</code> / <code>ALIBABA_APP_SECRET</code> / <code>ALIBABA_SESSION</code> 后重启<br />
              搜索接口通常不返回个人邮箱；优先在国际站后台报价，有公司采购邮箱再补录。Agent 没有邮箱不会发信。
            </div>
          )}

          {tab === 'government' || sources.find((s) => s.key === 'alibaba')?.ready ? (
            <div className="mb-3 flex gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="关键词，如 power tools"
                className="h-9 flex-1 rounded-lg border border-slate-200 px-3 text-xs focus:border-primary focus:outline-none"
              />
              <button
                onClick={() => search(tab === 'commercial' ? 'alibaba' : source)}
                disabled={loading || (tab === 'commercial' && !sources.find((s) => s.key === 'alibaba')?.ready)}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? <Spinner className="h-3! w-3!" /> : <Download size={13} />}
                {source === 'all' ? '聚合拉取' : '拉取'}
              </button>
            </div>
          ) : null}

          {tab === 'commercial' && (
            <div className="mb-4">
              <div className="mb-1 text-[12px] font-semibold text-slate-700">付费聚合 / 卖家后台导出 → JSON 导入</div>
              <p className="mb-2 text-[11px] text-slate-500">
                适用 TendersOnTime、Tendersinfo、dgMarket、BidNet、Mercell，或中国制造网/环球资源后台导出。字段：company / name / email / country / painPoints / url。
              </p>
              <textarea
                value={ingestText}
                onChange={(e) => setIngestText(e.target.value)}
                rows={8}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] focus:border-primary focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={ingestJson}
                  className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-medium text-white"
                >
                  导入 JSON
                </button>
                {ingestMsg && <span className="text-[11px] text-emerald-600">{ingestMsg}</span>}
              </div>
            </div>
          )}

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
                    {it.source} · {it.kind === 'commercial' ? '商业' : '政府'} · {it.country} {it.state || ''} {it.email ? `· ${it.email}` : '· 无公开邮箱'}
                    {it.amount ? ` · ${Math.round(it.amount).toLocaleString()}` : ''}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{it.painPoints}</p>
                </div>
              </label>
            ))}
            {tab === 'government' && !loading && items.length === 0 && (
              <div className="py-10 text-center text-xs text-slate-400">
                默认选「全部已接通源」，点「聚合拉取」一次拿多个官方政府源
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
