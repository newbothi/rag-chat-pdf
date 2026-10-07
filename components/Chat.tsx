'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, Source } from '@/lib/types';

export function Chat({ documentIds, hasDocuments }: { documentIds: string[]; hasDocuments: boolean }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, stop, error, setMessages } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });

  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    // documentIds viaja en el body → la API filtra la búsqueda por esos documentos
    sendMessage({ text }, { body: { documentIds } });
    setInput('');
  }

  return (
    <section className="flex h-full flex-1 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto p-4 md:p-8">
        {messages.length === 0 && (
          <div className="mx-auto mt-20 max-w-md text-center text-zinc-500">
            <p className="text-2xl">💬</p>
            <p className="mt-2">
              {hasDocuments
                ? 'Haz una pregunta sobre tus documentos.'
                : 'Sube un PDF en el panel izquierdo para empezar.'}
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
              }`}
            >
              {m.parts.map((p, i) =>
                p.type === 'text' ? (
                  <p key={i} className="whitespace-pre-wrap leading-relaxed">
                    {p.text}
                  </p>
                ) : null,
              )}
              {m.role === 'assistant' && <Sources sources={m.metadata?.sources} />}
            </div>
          </div>
        ))}

        {status === 'submitted' && <p className="animate-pulse text-sm text-zinc-500">Buscando en tus documentos…</p>}
        {error && <p className="text-sm text-red-600">Ocurrió un error: {error.message}</p>}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t border-zinc-200 p-4 dark:border-zinc-800">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pregunta algo sobre tus PDFs…"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        {busy ? (
          <button type="button" onClick={stop} className="rounded-lg bg-zinc-200 px-4 py-2 dark:bg-zinc-800">
            Detener
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            Enviar
          </button>
        )}
        {messages.length > 0 && !busy && (
          <button type="button" onClick={() => setMessages([])} className="px-2 text-sm text-zinc-500" title="Nueva conversación">
            Limpiar
          </button>
        )}
      </form>
    </section>
  );
}

function Sources({ sources }: { sources?: Source[] }) {
  if (!sources?.length) return null;
  return (
    <details className="mt-3 text-xs text-zinc-500">
      <summary className="cursor-pointer select-none">Fuentes ({sources.length})</summary>
      <ul className="mt-2 space-y-2">
        {sources.map((s) => (
          <li key={s.n} className="rounded bg-zinc-100 p-2 dark:bg-zinc-800">
            <span className="font-semibold">
              [{s.n}] {s.documentName} · pág. {s.page}
            </span>{' '}
            <span className="opacity-60">({(s.similarity * 100).toFixed(0)}% similitud)</span>
            <p className="mt-1 line-clamp-3 italic">{s.snippet}…</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
