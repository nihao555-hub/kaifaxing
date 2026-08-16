// 通用小组件：头像（渐变+姓名首字母，替代设计稿中的照片素材）、状态徽章

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#4f8bff,#2f6cff)',
  'linear-gradient(135deg,#ff9a62,#ff6b6b)',
  'linear-gradient(135deg,#34d399,#0ea5e9)',
  'linear-gradient(135deg,#a78bfa,#6366f1)',
  'linear-gradient(135deg,#f472b6,#fb7185)',
  'linear-gradient(135deg,#fbbf24,#f97316)',
  'linear-gradient(135deg,#2dd4bf,#059669)',
  'linear-gradient(135deg,#818cf8,#3b82f6)',
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({ name, size = 40, className = '' }) {
  const initials = (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const bg = AVATAR_GRADIENTS[hashStr(name || '?') % AVATAR_GRADIENTS.length];
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none ${className}`}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

export const STATUS_META = {
  replied: { label: '已回复', cls: 'bg-emerald-50 text-emerald-500' },
  following: { label: '跟进中', cls: 'bg-blue-50 text-primary' },
  uncontacted: { label: '未联系', cls: 'bg-amber-50 text-amber-500' },
};

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.uncontacted;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

export function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent align-middle ${className}`}
    />
  );
}
