import { useCallback, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import CustomerList from './components/CustomerList.jsx';
import MainPanel from './components/MainPanel.jsx';
import BatchModal from './components/BatchModal.jsx';
import AddCustomerModal from './components/AddCustomerModal.jsx';
import ImportRfqModal from './components/ImportRfqModal.jsx';
import LeadsPage from './components/LeadsPage.jsx';
import { api } from './api.js';

export default function App() {
  const [page, setPage] = useState('outreach');
  const [customers, setCustomers] = useState([]);
  const [inboxTotal, setInboxTotal] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [thread, setThread] = useState([]);
  const [aiPanel, setAiPanel] = useState(null);
  const [activities, setActivities] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [rfqOpen, setRfqOpen] = useState(false);
  const [agent, setAgent] = useState(null);

  const refreshCustomers = useCallback(async () => {
    const { customers: list, total } = await api.getCustomers({ view: 'inbox', limit: 200 });
    setCustomers(list);
    setInboxTotal(total || list.length);
    return list;
  }, []);

  useEffect(() => {
    refreshCustomers().then((list) => {
      if (list.length > 0) setSelectedId(list[0].id);
    });
  }, [refreshCustomers]);

  const loadThread = useCallback(async (id) => {
    if (!id) return;
    const { thread: t, aiPanel: p, activities: acts } = await api.getThread(id);
    setThread(t);
    setAiPanel(p);
    setActivities(acts || []);
  }, []);

  useEffect(() => {
    loadThread(selectedId);
  }, [selectedId, loadThread]);

  // 人工监控：Agent 工作时自动刷新名单、沟通历史与活动记录
  useEffect(() => {
    if (page !== 'outreach') return undefined;
    const tick = async () => {
      try {
        const [list, st] = await Promise.all([refreshCustomers(), api.getAgent()]);
        setAgent(st);
        if (selectedId) await loadThread(selectedId);
        if (!selectedId && list?.[0]) setSelectedId(list[0].id);
      } catch { /* 忽略轮询错误 */ }
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => clearInterval(timer);
  }, [refreshCustomers, loadThread, selectedId, page]);

  const regenerate = async () => {
    if (!selectedId || generating) return;
    setGenerating(true);
    try {
      const { draft, evaluation } = await api.generate(selectedId);
      setAiPanel({ draft, evaluation });
    } catch (err) {
      alert(`AI 生成失败：${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const selected = customers.find((c) => c.id === selectedId);

  return (
    <div className="flex h-full overflow-hidden bg-page">
      <Sidebar page={page} onNavigate={setPage} />
      {page === 'leads' ? (
        <LeadsPage
          onGoOutreach={async () => {
            setPage('outreach');
            const list = await refreshCustomers();
            try { setAgent(await api.startAgent()); } catch { /* ignore */ }
            if (list?.[0]) setSelectedId(list[0].id);
          }}
        />
      ) : (
        <>
      <CustomerList
        customers={customers}
        total={inboxTotal}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onAdd={() => setAddOpen(true)}
        onImportRfq={() => setRfqOpen(true)}
        onGoLeads={() => setPage('leads')}
      />
      <MainPanel
        customer={selected}
        thread={thread}
        aiPanel={aiPanel}
        activities={activities}
        agent={agent}
        generating={generating || (agent?.busy && agent?.current?.id === selectedId)}
        onRegenerate={regenerate}
        onNewOutreach={() => setBatchOpen(true)}
        onStopAgent={async () => setAgent(await api.stopAgent())}
        onStartAgent={async () => setAgent(await api.startAgent())}
      />

      {batchOpen && (
        <BatchModal
          customers={customers}
          defaultSelected={selectedId}
          onClose={() => {
            setBatchOpen(false);
            refreshCustomers();
            loadThread(selectedId);
          }}
          onSent={() => {
            refreshCustomers();
            loadThread(selectedId);
          }}
        />
      )}

      {addOpen && (
        <AddCustomerModal
          onClose={() => setAddOpen(false)}
          onAdded={(customer) => {
            setAddOpen(false);
            refreshCustomers().then(() => setSelectedId(customer.id));
          }}
        />
      )}

      {rfqOpen && (
        <ImportRfqModal
          onClose={() => setRfqOpen(false)}
          onImported={(created) => {
            setRfqOpen(false);
            refreshCustomers().then(() => {
              if (created?.[0]) setSelectedId(created[0].id);
            });
          }}
        />
      )}
        </>
      )}
    </div>
  );
}
