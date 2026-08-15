import { useState } from 'react';
import { Linkedin, ChevronDown, Plus, Clock } from 'lucide-react';
import { Avatar, StatusBadge } from './common.jsx';
import ThreadTimeline from './ThreadTimeline.jsx';
import AiPanel from './AiPanel.jsx';

const TABS = ['沟通历史', '客户详情', '相关笔记', '活动记录'];

function CustomerDetail({ customer }) {
  const rows = [
    ['姓名', customer.name],
    ['公司', customer.company],
    ['职位', customer.title],
    ['邮箱', customer.email],
    ['国家/地区', customer.country],
    ['时区', customer.timezone],
    ['行业', customer.industry],
    ['已知痛点', customer.painPoints],
    ['数据来源', customer.source || '手动添加'],
    ['来源链接', customer.sourceUrl || ''],
  ];
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="grid grid-cols-1 gap-x-8 gap-y-4">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 text-[13px]">
            <span className="w-20 shrink-0 text-slate-400">{k}</span>
            {String(v).startsWith('http') ? (
              <a href={v} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
                {v}
              </a>
            ) : (
              <span className="text-slate-700">{v || '—'}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LocalTime({ timezone }) {
  try {
    const t = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
    return (
      <span className="ml-2 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
        <Clock size={10} />
        当地 {t}
      </span>
    );
  } catch {
    return null;
  }
}

// 右侧主区域：客户头部 + Tabs + 沟通历史/AI 面板
function ActivityLog({ activities }) {
  if (!activities || activities.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
        暂无活动记录
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {activities.map((a) => (
        <div key={a.id} className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-slate-800">{a.action}</span>
            <span className="text-[11px] text-slate-400">{a.time}</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">{a.detail}</p>
        </div>
      ))}
    </div>
  );
}

export default function MainPanel({
  customer, thread, aiPanel, activities, agent, generating,
  onRegenerate, onNewOutreach, onStopAgent, onStartAgent,
}) {
  const [tab, setTab] = useState('沟通历史');
  const [menuOpen, setMenuOpen] = useState(false);

  if (!customer) {
    return <main className="flex flex-1 items-center justify-center text-sm text-slate-400">请选择客户</main>;
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* 头部 */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 pt-4 pb-0">
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={customer.name} size={44} />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[17px] font-bold text-slate-800">{customer.name}</h1>
                <a
                  href={customer.linkedin || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-4.5 w-4.5 items-center justify-center rounded-sm bg-[#0A66C2] text-white"
                >
                  <Linkedin size={11} fill="currentColor" strokeWidth={0} />
                </a>
                <StatusBadge status={customer.status} />
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                {customer.company}
                <span className="mx-1.5">·</span>
                {customer.title}
                <LocalTime timezone={customer.timezone} />
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2.5">
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-[13px] text-slate-600 hover:bg-slate-50"
                >
                  更多操作
                  <ChevronDown size={14} className="text-slate-400" />
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 z-20 mt-1 w-36 rounded-lg border border-slate-100 bg-white py-1 shadow-lg"
                    onMouseLeave={() => setMenuOpen(false)}
                  >
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        agent?.enabled ? onStopAgent?.() : onStartAgent?.();
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
                    >
                      {agent?.enabled ? '停止 Agent' : '启动 Agent'}
                    </button>
                    {['标记为已回复', '导出沟通记录', '归档客户'].map((x) => (
                      <button
                        key={x}
                        onClick={() => setMenuOpen(false)}
                        className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
                      >
                        {x}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={onNewOutreach}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-medium text-white shadow-sm shadow-primary/30 hover:bg-blue-600"
              >
                <Plus size={15} />
                新建开发信
              </button>
            </div>
          </div>

          {/* Tabs */}
          <nav className="flex gap-7 text-[13px]">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative pb-2.5 ${
                  tab === t ? 'font-medium text-primary' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t}
                {tab === t && (
                  <span className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-primary" />
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* 内容区 */}
      <div className="thin-scroll flex flex-1 gap-5 overflow-y-auto bg-page p-5">
        <div className="min-w-0 flex-1">
          {tab === '沟通历史' && <ThreadTimeline thread={thread} />}
          {tab === '客户详情' && <CustomerDetail customer={customer} />}
          {tab === '相关笔记' && (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
              暂无笔记
            </div>
          )}
          {tab === '活动记录' && <ActivityLog activities={activities} />}
        </div>
        <div className="w-[340px] shrink-0">
          <AiPanel aiPanel={aiPanel} generating={generating} onRegenerate={onRegenerate} />
        </div>
      </div>
    </main>
  );
}
