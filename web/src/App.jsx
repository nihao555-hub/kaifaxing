import { useCallback, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import CustomerList from './components/CustomerList.jsx';
import MainPanel from './components/MainPanel.jsx';
import BatchModal from './components/BatchModal.jsx';
import AddCustomerModal from './components/AddCustomerModal.jsx';
import { api } from './api.js';

export default function App() {
  const [customers, setCustomers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [thread, setThread] = useState([]);
  const [aiPanel, setAiPanel] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const refreshCustomers = useCallback(async () => {
    const { customers: list } = await api.getCustomers();
    setCustomers(list);
    return list;
  }, []);

  useEffect(() => {
    refreshCustomers().then((list) => {
      if (list.length > 0) setSelectedId(list[0].id);
    });
  }, [refreshCustomers]);

  const loadThread = useCallback(async (id) => {
    if (!id) return;
    const { thread: t, aiPanel: p } = await api.getThread(id);
    setThread(t);
    setAiPanel(p);
  }, []);

  useEffect(() => {
    loadThread(selectedId);
  }, [selectedId, loadThread]);

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
      <Sidebar />
      <CustomerList
        customers={customers}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onAdd={() => setAddOpen(true)}
      />
      <MainPanel
        customer={selected}
        thread={thread}
        aiPanel={aiPanel}
        generating={generating}
        onRegenerate={regenerate}
        onNewOutreach={() => setBatchOpen(true)}
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
    </div>
  );
}
