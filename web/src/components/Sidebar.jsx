import { Send, LayoutGrid, BarChart3, Settings, Info } from 'lucide-react';
import { Avatar } from './common.jsx';

const NAV_ITEMS = [
  { key: 'outreach', label: '开发信', icon: Send },
  { key: 'templates', label: '模板', icon: LayoutGrid },
  { key: 'analytics', label: '数据分析', icon: BarChart3 },
  { key: 'settings', label: '设置', icon: Settings },
];

// 左侧深色导航栏（仅"开发信"页面可用，其余为占位导航）
export default function Sidebar() {
  return (
    <aside className="flex w-[76px] shrink-0 flex-col items-center bg-sidebar py-4">
      {/* Logo */}
      <div className="mb-5 flex flex-col items-center gap-1.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow">
          <img src="/logo.svg" alt="OutreachAI" className="h-7 w-7" />
        </div>
        <span className="text-[10px] font-medium text-white/90">OutreachAI</span>
      </div>

      {/* 导航 */}
      <nav className="flex flex-col items-center gap-2">
        {NAV_ITEMS.map(({ key, label, icon: Icon }, idx) => {
          const active = idx === 0;
          return (
            <button
              key={key}
              className={`flex w-[60px] flex-col items-center gap-1 rounded-xl py-2.5 transition-colors ${
                active
                  ? 'bg-primary text-white shadow-lg shadow-primary/30'
                  : 'text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
              title={active ? label : `${label}（暂未开放）`}
            >
              <Icon size={20} strokeWidth={2} />
              <span className="text-[10px] leading-none">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* 帮助中心 + 账号 */}
      <button className="mb-4 flex flex-col items-center gap-1 text-slate-400 hover:text-white">
        <Info size={18} />
        <span className="text-[10px] leading-none">帮助中心</span>
      </button>
      <div className="flex flex-col items-center gap-1">
        <Avatar name="Alice L" size={36} className="ring-2 ring-white/30" />
        <span className="text-[10px] text-white/90">Alice</span>
        <span className="rounded bg-white/15 px-1.5 py-px text-[9px] text-white/70">Pro 版</span>
      </div>
    </aside>
  );
}
