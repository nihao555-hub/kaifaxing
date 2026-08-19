import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Sparkles, Send, Clock, Globe2, ShieldCheck, CheckCircle2,
  AlertCircle, RefreshCw, ChevronLeft,
} from 'lucide-react';
import { api } from '../api.js';
import { Avatar, StatusBadge, Spinner } from './common.jsx';

const STEPS = ['选择客户', 'AI 生成', '发送策略', '发送进度'];

function localTime(tz) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz, month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    }).format(new Date());
  } catch {
    return '';
  }
}

function StepBar({ step }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium ${
                i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {i < step ? '✓' : i + 1}
            </span>
            <span className={`text-xs ${i === step ? 'font-medium text-slate-800' : 'text-slate-400'}`}>{s}</span>
          </div>
          {i < STEPS.length - 1 && <span className="h-px w-6 bg-slate-200" />}
        </div>
      ))}
    </div>
  );
}

export default function BatchModal({ customers, defaultSelected, onClose, onSent }) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(new Set(defaultSelected ? [defaultSelected] : []));
  const [drafts, setDrafts] = useState({}); // customerId -> {status, subject, body, painPointAnalysis, evaluation, sendTime, error}
  const [mode, setMode] = useState('smart');
  const [quota, setQuota] = useState(null);
  const [job, setJob] = useState(null);
  const [sendErr, setSendErr] = useState('');
  const abortRef = useRef(false);

  useEffect(() => {
    api.getQuota().then(setQuota).catch(() => {});
    return () => { abortRef.current = true; };
  }, []);

  // 轮询任务进度
  useEffect(() => {
    if (!job) return;
    const timer = setInterval(async () => {
      try {
        const { job: j } = await api.getJob(job.id);
        setJob(j);
        if (j.items.every((t) => t.status === 'sent' || t.status === 'failed')) {
          clearInterval(timer);
          onSent?.();
        }
      } catch { /* 忽略轮询错误 */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [job?.id]);

  const selectedCustomers = useMemo(
    () => customers.filter((c) => selected.has(c.id)),
    [customers, selected]
  );

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const generateOne = async (c) => {
    setDrafts((d) => ({ ...d, [c.id]: { ...(d[c.id] || {}), status: 'generating' } }));
    try {
      const { draft, evaluation, sendTime } = await api.generate(c.id);
      if (abortRef.current) return;
      setDrafts((d) => ({
        ...d,
        [c.id]: { status: 'done', ...draft, evaluation, sendTime },
      }));
    } catch (err) {
      if (abortRef.current) return;
      setDrafts((d) => ({ ...d, [c.id]: { status: 'error', error: String(err.message || err) } }));
    }
  };

  // 进入第 2 步时逐个生成（串行，避免并发压垮接口）
  const startGenerate = async () => {
    setStep(1);
    for (const c of selectedCustomers) {
      if (abortRef.current) return;
      const cur = drafts[c.id];
      if (cur?.status === 'done') continue;
      // eslint-disable-next-line no-await-in-loop
      await generateOne(c);
    }
  };

  const doneCount = selectedCustomers.filter((c) => drafts[c.id]?.status === 'done').length;
  const generatingNow = selectedCustomers.some((c) => drafts[c.id]?.status === 'generating');

  const send = async () => {
    setSendErr('');
    try {
      const items = selectedCustomers
        .filter((c) => drafts[c.id]?.status === 'done')
        .map((c) => ({ customerId: c.id, subject: drafts[c.id].subject, body: drafts[c.id].body }));
      const { job: j } = await api.batchSend(items, mode);
      setJob(j);
      setStep(3);
    } catch (err) {
      setSendErr(String(err.message || err));
    }
  };

  const updateDraft = (id, patch) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="fade-in-up flex h-[86vh] w-[880px] max-w-full flex-col rounded-2xl bg-white shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
            <Sparkles size={16} className="text-primary" />
            批量发开发信
          </div>
          <StepBar step={step} />
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        {/* 内容 */}
        <div className="thin-scroll flex-1 overflow-y-auto px-6 py-4">
          {/* 第 1 步：选择客户 */}
          {step === 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  已选择 <span className="font-semibold text-primary">{selected.size}</span> 位客户，AI
                  将为每位客户单独研究痛点并生成个性化开发信
                </p>
                <button
                  onClick={() =>
                    setSelected(
                      selected.size === customers.length ? new Set() : new Set(customers.map((c) => c.id))
                    )
                  }
                  className="text-xs font-medium text-primary hover:text-blue-600"
                >
                  {selected.size === customers.length ? '取消全选' : '全选'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {customers.map((c) => {
                  const on = selected.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                        on ? 'border-primary bg-primary-light' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span
                        className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border text-white ${
                          on ? 'border-primary bg-primary' : 'border-slate-300'
                        }`}
                      >
                        {on && <CheckCircle2 size={12} />}
                      </span>
                      <Avatar name={c.name} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-slate-800">{c.name}</span>
                          <StatusBadge status={c.status} />
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-400">
                          {c.company} · {c.country}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                          <Clock size={10} />
                          当地时间 {localTime(c.timezone)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 第 2 步：AI 生成（可编辑） */}
          {step === 1 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-slate-600">
                <Sparkles size={13} className="shrink-0 text-primary" />
                AI Agent 正在逐个研究客户行业与痛点，生成「让对方眼前一亮」的个性化开发信（{doneCount}/
                {selectedCustomers.length}）
                {generatingNow && <Spinner className="ml-1 h-3! w-3! text-primary" />}
              </div>

              {selectedCustomers.map((c) => {
                const d = drafts[c.id] || { status: 'pending' };
                return (
                  <div key={c.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-2 flex items-center gap-2.5">
                      <Avatar name={c.name} size={30} />
                      <div className="flex-1">
                        <span className="text-[13px] font-semibold text-slate-800">{c.name}</span>
                        <span className="ml-2 text-xs text-slate-400">{c.company} · {c.country}</span>
                      </div>
                      {d.status === 'done' && d.evaluation && (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
                          AI 评分 {d.evaluation.total} · {d.evaluation.grade}
                        </span>
                      )}
                      {d.status === 'generating' && (
                        <span className="flex items-center gap-1.5 text-xs text-primary">
                          <Spinner className="h-3! w-3!" /> 生成中…
                        </span>
                      )}
                      {d.status === 'pending' && <span className="text-xs text-slate-400">排队中</span>}
                      {(d.status === 'done' || d.status === 'error') && (
                        <button
                          onClick={() => generateOne(c)}
                          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50"
                        >
                          <RefreshCw size={11} /> 重新生成
                        </button>
                      )}
                    </div>

                    {d.status === 'error' && (
                      <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-500">
                        <AlertCircle size={13} /> {d.error}
                      </div>
                    )}

                    {d.status === 'done' && (
                      <>
                        <input
                          value={d.subject}
                          onChange={(e) => updateDraft(c.id, { subject: e.target.value })}
                          className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-primary focus:outline-none"
                        />
                        <textarea
                          value={d.body}
                          onChange={(e) => updateDraft(c.id, { body: e.target.value })}
                          rows={6}
                          className="thin-scroll w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs leading-relaxed text-slate-600 focus:border-primary focus:outline-none"
                        />
                        {d.painPointAnalysis && (
                          <div className="mt-1.5 rounded-lg bg-violet-50 px-3 py-2 text-[11px] leading-relaxed text-violet-600">
                            <span className="font-semibold">痛点分析：</span>
                            {d.painPointAnalysis}
                          </div>
                        )}
                        {d.sendTime && (
                          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Globe2 size={11} className="text-primary" />
                            建议发送时间：{d.sendTime.localTime}（{d.sendTime.reason}）
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 第 3 步：发送策略 */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setMode('smart')}
                  className={`rounded-xl border p-4 text-left ${
                    mode === 'smart' ? 'border-primary bg-primary-light' : 'border-slate-200'
                  }`}
                >
                  <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                    <Globe2 size={15} className="text-primary" />
                    智能调度（推荐）
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">
                    按每位收件人所在时区，自动安排在其当地
                    <span className="font-medium text-slate-700">周二至周四上午 9-11 点</span>
                    的黄金打开时段发送，避开周末与深夜。
                  </p>
                </button>
                <button
                  onClick={() => setMode('now')}
                  className={`rounded-xl border p-4 text-left ${
                    mode === 'now' ? 'border-primary bg-primary-light' : 'border-slate-200'
                  }`}
                >
                  <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                    <Send size={15} className="text-primary" />
                    立即发送
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">
                    忽略时区窗口，立刻按防封频率依次发出。适合测试或客户明确在线时使用。
                  </p>
                </button>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                  <ShieldCheck size={15} className="text-emerald-500" />
                  发信频率保护（自动生效）
                </div>
                <ul className="flex flex-col gap-1 text-xs leading-relaxed text-slate-500">
                  <li>· 相邻两封随机间隔 {quota ? `${quota.minIntervalSec}-${quota.maxIntervalSec}` : '45-120'} 秒，模拟人工节奏，降低进垃圾箱概率</li>
                  <li>· 单日上限 {quota?.dailyLimit ?? 50} 封（今日已发 {quota?.sentToday ?? 0} 封），保护 163 发信账号信誉</li>
                  <li>· 每封均为 AI 个性化内容，非重复模板，进一步降低被判定群发的风险</li>
                </ul>
              </div>

              <div className="rounded-xl border border-slate-200">
                <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-medium text-slate-500">
                  待发送清单（{doneCount} 封）
                </div>
                {selectedCustomers
                  .filter((c) => drafts[c.id]?.status === 'done')
                  .map((c) => (
                    <div key={c.id} className="flex items-center gap-3 border-b border-slate-50 px-4 py-2.5 last:border-0">
                      <Avatar name={c.name} size={28} />
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-slate-700">{c.name}</span>
                        <span className="ml-2 truncate text-[11px] text-slate-400">{drafts[c.id].subject}</span>
                      </div>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {mode === 'smart' && drafts[c.id].sendTime ? drafts[c.id].sendTime.localTime : '排队立即发送'}
                      </span>
                    </div>
                  ))}
              </div>

              {sendErr && (
                <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-500">
                  <AlertCircle size={13} /> {sendErr}
                </div>
              )}
            </div>
          )}

          {/* 第 4 步：发送进度 */}
          {step === 3 && job && (
            <div className="flex flex-col gap-2.5">
              <div className="mb-1 rounded-lg bg-blue-50 px-3 py-2 text-xs text-slate-600">
                任务 <span className="font-mono">{job.id}</span> 已创建（{job.mode === 'smart' ? '智能调度' : '立即发送'}）。
                关闭此窗口不影响后台按计划发送。
              </div>
              {job.items.map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                  <Avatar name={t.customerName} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-700">
                      {t.customerName}
                      <span className="ml-2 font-normal text-slate-400">{t.email}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-400">{t.subject}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{t.scheduleNote}</div>
                  </div>
                  <div className="shrink-0">
                    {t.status === 'sent' && (
                      <span className="flex items-center gap-1 text-xs font-medium text-emerald-500">
                        <CheckCircle2 size={14} /> 已送达
                      </span>
                    )}
                    {t.status === 'failed' && (
                      <span className="flex items-center gap-1 text-xs text-red-500" title={t.error}>
                        <AlertCircle size={14} /> 失败
                      </span>
                    )}
                    {t.status === 'sending' && (
                      <span className="flex items-center gap-1 text-xs text-primary">
                        <Spinner className="h-3! w-3!" /> 发送中
                      </span>
                    )}
                    {t.status === 'scheduled' && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <Clock size={13} /> {new Date(t.sendAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3.5">
          <button
            onClick={() => (step === 0 || step === 3 ? onClose() : setStep(step - 1))}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-4 py-2 text-[13px] text-slate-600 hover:bg-slate-50"
          >
            {step === 0 || step === 3 ? '关闭' : (<><ChevronLeft size={14} /> 上一步</>)}
          </button>
          {step === 0 && (
            <button
              onClick={startGenerate}
              disabled={selected.size === 0}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-[13px] font-medium text-white shadow-sm shadow-primary/30 hover:bg-blue-600 disabled:opacity-40"
            >
              <Sparkles size={14} /> AI 生成开发信（{selected.size}）
            </button>
          )}
          {step === 1 && (
            <button
              onClick={() => setStep(2)}
              disabled={doneCount === 0 || generatingNow}
              className="rounded-lg bg-primary px-5 py-2 text-[13px] font-medium text-white shadow-sm shadow-primary/30 hover:bg-blue-600 disabled:opacity-40"
            >
              下一步：发送策略（{doneCount} 封就绪）
            </button>
          )}
          {step === 2 && (
            <button
              onClick={send}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-[13px] font-medium text-white shadow-sm shadow-primary/30 hover:bg-blue-600"
            >
              <Send size={14} /> 确认发送 {doneCount} 封
            </button>
          )}
          {step === 3 && (
            <button
              onClick={onClose}
              className="rounded-lg bg-primary px-5 py-2 text-[13px] font-medium text-white hover:bg-blue-600"
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
