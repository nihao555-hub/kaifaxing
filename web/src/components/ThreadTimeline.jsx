import { useState } from 'react';
import { Send, Reply, ChevronDown, ChevronUp } from 'lucide-react';

// 单条邮件卡片（可展开查看全文）
function MailCard({ item }) {
  const [open, setOpen] = useState(false);
  const outbound = item.type === 'outbound';
  const preview = item.body.split('\n').filter(Boolean).slice(outbound ? 1 : 1, outbound ? 3 : 4);

  return (
    <div className="relative pb-6 pl-10">
      {/* 时间轴节点 */}
      <span
        className={`absolute top-0.5 left-0 flex h-6 w-6 items-center justify-center rounded-full text-white ${
          outbound ? 'bg-primary' : 'bg-slate-500'
        }`}
      >
        {outbound ? <Send size={12} /> : <Reply size={12} />}
      </span>

      <div className="mb-2 text-xs text-slate-400">
        <span className="font-medium text-slate-500">{outbound ? 'AI 发送' : '客户回复'}</span>
        <span className="mx-1.5">·</span>
        {item.time}
      </div>

      <div className="fade-in-up rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-800">
            {outbound ? item.label : item.subject}
          </span>
          {outbound && item.status === 'delivered' && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] leading-none font-medium text-emerald-500">
              已送达
            </span>
          )}
        </div>

        {outbound && <div className="mb-1 text-xs text-slate-500">主题：{item.subject}</div>}

        <div className="text-xs leading-relaxed whitespace-pre-wrap text-slate-600">
          {open ? item.body : `${preview.join('\n').slice(0, 90)}...`}
        </div>

        <button
          onClick={() => setOpen(!open)}
          className="mt-2.5 flex items-center gap-1 text-xs font-medium text-primary hover:text-blue-600"
        >
          {open ? '收起详情' : '查看详情'}
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>
    </div>
  );
}

// 沟通历史时间轴
export default function ThreadTimeline({ thread }) {
  if (!thread || thread.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
        <Send size={28} className="text-slate-300" />
        <p className="text-sm">暂无沟通记录，点击右上角「新建开发信」开始触达</p>
      </div>
    );
  }
  return (
    <div className="relative">
      {/* 时间轴竖线 */}
      <span className="absolute top-2 bottom-8 left-3 w-px bg-slate-200" />
      {thread.map((item) => (
        <MailCard key={item.id} item={item} />
      ))}
      <div className="pb-2 pl-10">
        <span className="inline-block rounded-lg bg-slate-100 px-4 py-1.5 text-xs text-slate-400">
          已无更多记录
        </span>
      </div>
    </div>
  );
}
