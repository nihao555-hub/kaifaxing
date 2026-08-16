import { useState } from 'react';
import { Sparkles, Copy, Check, Info, RefreshCw } from 'lucide-react';
import { Spinner } from './common.jsx';

// 环形评分
function ScoreRing({ score }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r={r} fill="none" stroke="#E8EEF9" strokeWidth="5" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke="#2F6CFF"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 36 36)"
      />
      <text x="33" y="38" textAnchor="middle" fontSize="20" fontWeight="700" fill="#1e293b">
        {score}
      </text>
      <text x="49" y="40" fontSize="10" fill="#94a3b8">
        分
      </text>
    </svg>
  );
}

// 右侧：AI 生成的开发信内容 + AI 评估
export default function AiPanel({ aiPanel, generating, onRegenerate }) {
  const [copied, setCopied] = useState(false);
  const draft = aiPanel?.draft;
  const ev = aiPanel?.evaluation;

  const copy = async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(`主题: ${draft.subject}\n\n${draft.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* AI 生成的开发信内容 */}
      <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
            <Sparkles size={15} className="text-primary" />
            AI 生成的开发信内容
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onRegenerate}
              disabled={generating}
              title="重新生成"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              {generating ? <Spinner className="h-3.5! w-3.5! text-primary" /> : <RefreshCw size={13} />}
            </button>
            <button
              onClick={copy}
              className="flex h-7 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        </div>

        {generating ? (
          <div className="flex flex-col items-center gap-3 py-10 text-slate-400">
            <Spinner className="h-6! w-6! text-primary" />
            <span className="text-xs">AI 正在研究客户痛点并撰写开发信…</span>
          </div>
        ) : draft ? (
          <>
            <p className="mb-2 text-xs leading-relaxed text-slate-700">
              <span className="text-slate-500">主题：</span>
              <span className="font-medium">{draft.subject}</span>
            </p>
            <p className="text-xs leading-relaxed whitespace-pre-wrap text-slate-600">{draft.body}</p>
            {draft.intent && (
              <div className="mt-3 rounded-lg bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-700">
                <span className="font-semibold">回信意图：</span>
                {draft.intent}
                {draft.contextUsed ? ` · 上下文：${draft.contextUsed}` : ''}
              </div>
            )}
            {draft.painPointAnalysis && (
              <div className="mt-3 rounded-lg bg-violet-50 p-2.5 text-[11px] leading-relaxed text-violet-600">
                <span className="font-semibold">{draft.strategy ? '回信策略：' : '痛点分析：'}</span>
                {draft.painPointAnalysis}
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400">
            暂无 AI 草稿，点击右上角 <RefreshCw size={11} className="inline" /> 为该客户生成开发信
          </div>
        )}
      </div>

      {/* AI 评估 */}
      <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
          <Sparkles size={15} className="text-primary" />
          AI 评估
        </div>

        {ev ? (
          <>
            <div className="mb-4 flex items-center gap-4">
              <ScoreRing score={ev.total} />
              <div>
                <div className="flex items-center gap-1 text-lg font-bold text-slate-800">
                  {ev.grade}
                  <Info size={13} className="text-slate-300" />
                </div>
                <div className="text-xs text-slate-400">AI 综合评分</div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {ev.dimensions.map((d) => (
                <div key={d.key} className="flex items-center gap-2.5">
                  <span className="w-[62px] shrink-0 text-xs text-slate-500">{d.key}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${d.score}%` }}
                    />
                  </div>
                  <span className="w-11 shrink-0 text-right text-[11px] text-slate-400">
                    <span className="font-medium text-slate-600">{d.score}</span>/100
                  </span>
                </div>
              ))}
            </div>

            {ev.suggestion && (
              <div className="mt-4 rounded-lg bg-blue-50 p-3 text-xs leading-relaxed text-slate-600">
                <span className="font-semibold text-primary">AI 建议！</span>
                {ev.suggestion}
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400">生成开发信后自动进行 AI 评分</div>
        )}
      </div>
    </div>
  );
}
