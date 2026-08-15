import { useState } from 'react';
import { X, UserPlus } from 'lucide-react';
import { api } from '../api.js';

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin',
  'Europe/Paris', 'Europe/Madrid', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney',
];

const FIELDS = [
  ['name', '姓名 *', 'Michael Smith'],
  ['email', '邮箱 *', 'buyer@their-company.com'],
  ['company', '公司', 'Acme Corporation'],
  ['title', '职位', 'Purchasing Manager'],
  ['country', '国家/地区', '美国'],
  ['industry', '所在行业', '消费电子'],
];

export default function AddCustomerModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ timezone: 'America/New_York' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setErr('');
    if (!form.name || !form.email) return setErr('姓名和邮箱为必填项');
    setSaving(true);
    try {
      const { customer } = await api.addCustomer(form);
      onAdded(customer);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="fade-in-up w-[480px] max-w-full rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
            <UserPlus size={16} className="text-primary" /> 添加客户
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map(([key, label, ph]) => (
            <label key={key} className="flex flex-col gap-1 text-xs text-slate-500">
              {label}
              <input
                value={form[key] || ''}
                onChange={set(key)}
                placeholder={ph}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:border-primary focus:outline-none"
              />
            </label>
          ))}
          <label className="col-span-2 flex flex-col gap-1 text-xs text-slate-500">
            时区（用于计算最佳发送时间）
            <select
              value={form.timezone}
              onChange={set('timezone')}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:border-primary focus:outline-none"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs text-slate-500">
            已知痛点/背景（AI 将据此个性化开发信）
            <textarea
              value={form.painPoints || ''}
              onChange={set('painPoints')}
              rows={3}
              placeholder="例如：现有供应商交期不稳定、正在寻找有 CE 认证的工厂…"
              className="resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:border-primary focus:outline-none"
            />
          </label>
        </div>

        {err && <p className="mt-3 text-xs text-red-500">{err}</p>}

        <div className="mt-5 flex justify-end gap-2.5">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] text-slate-600 hover:bg-slate-50">
            取消
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-primary px-5 py-2 text-[13px] font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存客户'}
          </button>
        </div>
      </div>
    </div>
  );
}
