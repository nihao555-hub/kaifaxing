import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function SettingsPage() {
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [cseId, setCseId] = useState('');
  const [serperKey, setSerperKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    const data = await api.searchStatus();
    setStatus(data);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const data = await api.saveSearchSettings({ apiKey, cseId, serperKey });
      setStatus(data);
      setApiKey('');
      setCseId('');
      setSerperKey('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    setError('');
    try {
      setStatus(await api.saveSearchSettings({ clear: true }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setError('');
    setTest(null);
    try {
      setTest(await api.testGoogleSearch({}));
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f6f8fb]">
      <div className="border-b border-[#e8edf4] bg-white px-8 py-5">
        <div className="text-[18px] font-semibold text-[#1e293b]">设置</div>
        <p className="mt-1 text-[12px] text-[#64748b]">把谷歌搜索接到自动背调。不抓 google.com 结果页，不绕验证码。</p>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <section className="max-w-[640px] rounded-xl border border-[#e8edf4] bg-white p-5 shadow-sm">
          <div className="text-[14px] font-medium text-[#1e293b]">谷歌搜索</div>
          <p className="mt-2 text-[12px] leading-relaxed text-[#64748b]">
            GitHub 上能正经接的是官方
            {' '}
            <a className="text-primary hover:underline" href="https://github.com/googleapis/google-api-nodejs-client" target="_blank" rel="noreferrer">googleapis Custom Search</a>
            。先到
            {' '}
            <a className="text-primary hover:underline" href="https://programmablesearchengine.google.com/" target="_blank" rel="noreferrer">Programmable Search Engine</a>
            {' '}
            建一个「搜索整个网络」的引擎拿到 CX，再在 Google Cloud 打开 Custom Search API 建 Key。
            免费大约 100 次/天。新账号若已开不了 CSE，可改用
            {' '}
            <a className="text-primary hover:underline" href="https://serper.dev/" target="_blank" rel="noreferrer">Serper</a>
            。
          </p>

          <div className="mt-4 rounded-lg bg-[#f8fafc] px-3 py-2 text-[12px] text-[#475569]">
            {status?.ready
              ? `已接通：${status.cseReady ? `官方 CSE ${status.cseIdMasked || ''}` : `Serper ${status.serperMasked || ''}`}`
              : '还没接通。不填 Key 时背调仍走必应 / DuckDuckGo，谷歌公式只在浏览器里打开。'}
          </div>

          <label className="mt-4 block text-[12px] text-[#64748b]">
            Google API Key
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={status?.apiKeyMasked || 'AIza...'}
              className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-[13px] text-[#1e293b] outline-none focus:border-primary"
            />
          </label>
          <label className="mt-3 block text-[12px] text-[#64748b]">
            Search Engine ID（CX）
            <input
              value={cseId}
              onChange={(e) => setCseId(e.target.value)}
              placeholder={status?.cseIdMasked || '例如 017576662512468239146:omuauf_lfve'}
              className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-[13px] text-[#1e293b] outline-none focus:border-primary"
            />
          </label>
          <label className="mt-3 block text-[12px] text-[#64748b]">
            Serper API Key（可选，CSE 开不了时用）
            <input
              value={serperKey}
              onChange={(e) => setSerperKey(e.target.value)}
              placeholder={status?.serperMasked || 'serper.dev 的 Key'}
              className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-[13px] text-[#1e293b] outline-none focus:border-primary"
            />
          </label>

          {error && <div className="mt-3 text-[12px] text-rose-500">{error}</div>}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-primary px-3 py-1.5 text-[12px] text-white disabled:opacity-60"
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={runTest}
              disabled={testing}
              className="rounded-lg border border-[#e2e8f0] px-3 py-1.5 text-[12px] text-[#334155] disabled:opacity-60"
            >
              {testing ? '试跑中…' : '用 NMG 试跑谷歌'}
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={saving}
              className="rounded-lg px-3 py-1.5 text-[12px] text-[#94a3b8]"
            >
              清除已存 Key
            </button>
          </div>

          {test && (
            <div className="mt-4 rounded-lg border border-[#e2e8f0] px-3 py-3">
              <div className="text-[12px] font-medium text-[#334155]">
                {test.engine === 'google-cse' ? '谷歌官方 API' : 'Serper'}命中 {test.urls?.length || 0} 条
              </div>
              <div className="mt-1 truncate text-[11px] text-[#94a3b8]">{test.query}</div>
              <ul className="mt-2 space-y-1">
                {(test.items || []).map((item) => (
                  <li key={item.url} className="truncate text-[12px]">
                    <a href={item.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {item.title || item.url}
                    </a>
                  </li>
                ))}
              </ul>
              {test.snippetEmails?.length > 0 && (
                <div className="mt-2 text-[12px] text-[#475569]">摘要邮箱：{test.snippetEmails.join('、')}</div>
              )}
            </div>
          )}
        </section>

        <section className="mt-5 max-w-[640px] rounded-xl border border-[#e8edf4] bg-white p-5 shadow-sm">
          <div className="text-[14px] font-medium text-[#1e293b]">4.7 万条昵称询盘跑不通的原因</div>
          <p className="mt-2 text-[12px] leading-relaxed text-[#64748b]">
            公开列表字段就是买家显示名、国家、标题、一段需求。没有邮箱，详情页不登录是空壳，附件在登录墙后。
            邦阅/米课/脉脉里「不报价找联系方式」的主流是：付费看 Buyer profile、领英对人、Lusha/RocketReach/ContactOut 挖私人邮箱、猜 Gmail/Yahoo。
            这些这里都不做。
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-[#64748b]">
            不走官方联系时，公开源还能用的只有三件事：正文里写出的 Ltd/LLC 全称（入库和批量背调会抽）、列表缩略图里的 logo（抽屉里用浏览器以图搜图，产品图没用）、你从别处核到的法定名填进「补主体」。
            官方
            {' '}
            <a className="text-primary hover:underline" href="https://open.taobao.com/" target="_blank" rel="noreferrer">alibaba.icbu.rfq.search</a>
            {' '}
            也不是填 Key 就回填 4.7 万条公司名。当前官方 API：{status?.alibabaReady ? '已配置（仍需实跑看返回字段）' : '未配置，也尚未实跑通过'}。
          </p>
        </section>
      </div>
    </div>
  );
}
