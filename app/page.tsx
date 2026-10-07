'use client';

import { useCallback, useEffect, useState } from 'react';
import { Chat } from '@/components/Chat';
import { DocumentPanel } from '@/components/DocumentPanel';
import type { DocumentRow } from '@/lib/types';

export default function Home() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/documents', { cache: 'no-store' });
    if (res.ok) setDocuments(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <main className="flex h-dvh flex-col md:flex-row">
      <div className="max-h-[40dvh] md:max-h-none">
        <DocumentPanel documents={documents} selected={selected} onToggle={toggle} onChange={load} />
      </div>
      <Chat documentIds={selected} hasDocuments={documents.some((d) => d.status === 'ready')} />
    </main>
  );
}
