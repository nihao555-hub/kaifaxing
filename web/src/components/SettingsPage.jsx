import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function SettingsPage() {
  const [status, setStatus] = useState(null);
  const [paid, setPaid] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [cseId, setCseId] = useState('');
  const [serperKey, setSerperKey] = useState('');
  const [searchEngine, setSearchEngine] = useState('google');
  const [companiesHouseKey, setCompaniesHouseKey] = useState('');
  const [openCorporatesKey, setOpenCorporatesKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    const [data, sources] = await Promise.all([api.searchStatus(), api.paidSources().catch(() => null)]);
    setStatus(data);
    setPaid(sources);
    if (data?.engine) setSearchEngine(data.engine);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const data = await api.saveSearchSettings({
        apiKey, cseId, serperKey, searchEngine, companiesHouseKey, openCorporatesKey,
      });
      setStatus(data);
      if (data?.engine) setSearchEngine(data.engine);
      setApiKey('');
      setCseId('');
      setSerperKey('');
      setCompaniesHouseKey('');
      setOpenCorporatesKey('');
      setPaid(await api.paidSources().catch(() => null));
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
      const data = await api.saveSearchSettings({ clear: true });
      setStatus(data);
      setSearchEngine(data?.engine || 'google');
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
        <p className="mt-1 text-[12px] text-[#64748b]">接官方搜索和工商 Key。付费源能做到的，是买了解锁或授权库，不是公开页多了字段。</p>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <section className="max-w-[640px] rounded-xl border border-[#e8edf4] bg-white p-5 shadow-sm">
          <div className="text-[14px] font-medium text-[#1e293b]">谷歌搜索</div>
          <p className="mt-2 text-[12px] leading-relaxed text-[#64748b]">
            不走 Serper 时，用谷歌官方
            {' '}
            <a className="text-primary hover:underline" href="https://developers.google.com/custom-search/v1/overview" target="_blank" rel="noreferrer">Custom Search JSON API</a>
            。不能抓 google.com/search 的 HTML（会被 JS/验证码挡住，这里也不绕）。
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-[#64748b]">
            <li>
              到
              {' '}
              <a className="text-primary hover:underline" href="https://programmablesearchengine.google.com/" target="_blank" rel="noreferrer">Programmable Search Engine</a>
              {' '}
              新建引擎，打开「搜索整个网络」，复制 Search engine ID（CX）。
            </li>
            <li>Google Cloud 打开 Custom Search API，建一个 API Key。</li>
            <li>把 Key 和 CX 填到下面保存。免费大约 100 次/天。</li>
          </ol>

          <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
            {[
              { id: 'google', label: '只用谷歌官方' },
              { id: 'auto', label: '自动（先 CSE，没有再 Serper）' },
              { id: 'serper', label: '只用 Serper' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSearchEngine(opt.id)}
                className={`rounded-lg border px-3 py-1.5 ${
                  searchEngine === opt.id
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-[#e2e8f0] text-[#64748b]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-lg bg-[#f8fafc] px-3 py-2 text-[12px] text-[#475569]">
            {status?.cseReady
              ? `已接通谷歌官方 CSE ${status.cseIdMasked || ''}`
              : status?.needCse
                ? (status.setup || '还没接通谷歌官方 API。填 Key + CX 之前不会改走 Serper。')
                : status?.ready
                  ? `已接通：${status.engine === 'serper' ? `Serper ${status.serperMasked || ''}` : '自动回退到 Serper'}`
                  : '还没接通。不填 Key 时背调仍走必应 / DuckDuckGo，结果只显示核到的官网和角色邮箱。'}
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
            Serper API Key（可选；默认不用，只有上面选「自动」或「只用 Serper」才走）
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
                {test.engine === 'google-cse' ? '谷歌官方 API' : test.engine === 'serper' ? 'Serper' : '搜索'}命中 {test.urls?.length || 0} 条
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
          <div className="text-[14px] font-medium text-[#1e293b]">付费源为什么能做到</div>
          <p className="mt-2 text-[12px] leading-relaxed text-[#64748b]">
            他们不是在公开列表上多了一种魔法。能拿到公司名和联系方式，是因为买了平台解锁、买了授权库、或买了别人的通讯录。
            同一条路我们也能走：官方 Key 或后台导出。不会去爬登录墙、也不会猜私人邮箱。
          </p>
          <div className="mt-3 space-y-3">
            {(paid?.models || []).map((m) => (
              <div key={m.key} className="rounded-lg border border-[#e8edf4] bg-[#f8fafc] px-3 py-2.5">
                <div className="text-[12px] font-medium text-[#334155]">{m.title}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-[#64748b]">{m.how}</p>
                <p className="mt-1 text-[11px] text-[#334155]">我们怎么对齐：{m.weCan}</p>
                <p className="mt-0.5 text-[11px] text-[#94a3b8]">不做：{m.weWont}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 text-[11px] text-[#475569]">
            {(paid?.connectors || []).map((c) => (
              <div key={c.key}>
                <span className={c.ready ? 'text-emerald-600' : 'text-[#94a3b8]'}>{c.ready ? '已接通' : '未配 Key'}</span>
                {' · '}
                {c.name}
                {' · '}
                {c.need}
              </div>
            ))}
          </div>
          <label className="mt-4 block text-[12px] text-[#64748b]">
            Companies House API Key（英国工商，官网免费申请）
            <input
              value={companiesHouseKey}
              onChange={(e) => setCompaniesHouseKey(e.target.value)}
              placeholder={status?.companiesHouseMasked || 'developer.company-information.service.gov.uk'}
              className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-[13px] text-[#1e293b] outline-none focus:border-primary"
            />
          </label>
          <label className="mt-3 block text-[12px] text-[#64748b]">
            OpenCorporates API Key（可选，多国工商聚合）
            <input
              value={openCorporatesKey}
              onChange={(e) => setOpenCorporatesKey(e.target.value)}
              placeholder={status?.openCorporatesMasked || 'opencorporates.com 的 Key'}
              className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-[13px] text-[#1e293b] outline-none focus:border-primary"
            />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="mt-4 rounded-lg bg-primary px-3 py-1.5 text-[12px] text-white disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存工商 Key'}
          </button>
        </section>

        <section className="mt-5 max-w-[640px] rounded-xl border border-[#e8edf4] bg-white p-5 shadow-sm">
          <div className="text-[14px] font-medium text-[#1e293b]">4.7 万条昵称询盘跑不通的原因</div>
          <p className="mt-2 text-[12px] leading-relaxed text-[#64748b]">
            公开列表字段就是买家显示名、国家、标题、一段需求。没有邮箱，详情页不登录是空壳，附件在登录墙后。
            邦阅/米课/脉脉里「不报价找联系方式」的主流是：付费看 Buyer profile、领英对人、Lusha/RocketReach/ContactOut 挖私人邮箱、猜 Gmail/Yahoo。
            这些这里都不做。
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-[#64748b]">
            阿里询盘对齐外贸通的办法：先在国际站报价，再导出 buyer_company_name / buyer_email，按询盘 ID 回填；然后才跑工商/官网/角色邮箱。公开源另外两条路：正文 Ltd/LLC、型号交叉检索。缩略图只给人眼以图搜图。
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
