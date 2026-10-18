'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatMetadata, Source } from '@/lib/types';

const CONFIDENCE_STYLE = {
  alta: { icon: '●', text: 'Confianza alta', className: 'text-[#006300] dark:text-[#0ca30c]' },
  media: { icon: '◐', text: 'Confianza media', className: 'text-[#8a5a00] dark:text-[#fab219]' },
  baja: { icon: '○', text: 'Confianza baja: revisa las fuentes', className: 'text-[#b02e2e] dark:text-[#e66767]' },
} as const;

/** Probabilidad estimada (por el servicio Python) de que la respuesta sea útil, calculada antes de generarla. */
function Confidence({ confidence }: { confidence?: ChatMetadata['confidence'] }) {
  if (!confidence) return null;
  const style = CONFIDENCE_STYLE[confidence.level];
  const how =
    confidence.model === 'logistic'
      ? 'Regresión logística entrenada con el feedback de los usuarios'
      : 'Estimación inicial por similitud (aún no hay suficiente feedback para entrenar el modelo)';
  return (
    <p className={`mt-2 text-xs font-medium ${style.className}`} title={how}>
      <span aria-hidden>{style.icon}</span> {style.text} · {Math.round(confidence.probability * 100)}%
    </p>
  );
}

function Feedback({ queryId }: { queryId: string }) {
  const [sent, setSent] = useState<1 | -1 | null>(null);
  const [failed, setFailed] = useState(false);

  async function send(value: 1 | -1) {
    setSent(value);
    setFailed(false);
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queryId, value }),
    }).catch(() => null);
    if (!res?.ok) {
      setSent(null);
      setFailed(true);
    }
  }

  const base = 'rounded-md px-2 py-1 text-sm transition disabled:cursor-default';
  return (
    <div className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
      <span className="mr-1">{sent ? '¡Gracias!' : '¿Te sirvió?'}</span>
      <button
        type="button"
        aria-label="Respuesta útil"
        disabled={sent !== null}
        onClick={() => send(1)}
        className={`${base} ${sent === 1 ? 'bg-zinc-200 dark:bg-zinc-700' : sent ? 'opacity-30' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
      >
        👍
      </button>
      <button
        type="button"
        aria-label="Respuesta no útil"
        disabled={sent !== null}
        onClick={() => send(-1)}
        className={`${base} ${sent === -1 ? 'bg-zinc-200 dark:bg-zinc-700' : sent ? 'opacity-30' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
      >
        👎
      </button>
      {failed && <span className="text-red-600">No se pudo enviar</span>}
    </div>
  );
}

export function Chat({ documentIds, hasDocuments }: { documentIds: string[]; hasDocuments: boolean }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, stop, error, setMessages } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });

  const busy = status === 'submitted' || status === 'streaming';

  // biome-ignore lint/correctness/useExhaustiveDependencies: se desplaza cada vez que cambian los mensajes (también durante el streaming)
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
                  // biome-ignore lint/suspicious/noArrayIndexKey: las partes de un mensaje no tienen id y solo se agregan al final
                  <p key={i} className="whitespace-pre-wrap leading-relaxed">
                    {p.text}
                  </p>
                ) : null,
              )}
              {m.role === 'assistant' && (
                <>
                  <Confidence confidence={m.metadata?.confidence} />
                  <Sources sources={m.metadata?.sources} />
                  {m.metadata?.queryId && !(busy && m.id === messages.at(-1)?.id) && (
                    <Feedback queryId={m.metadata.queryId} />
                  )}
                </>
              )}
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
          <button
            type="button"
            onClick={() => setMessages([])}
            className="px-2 text-sm text-zinc-500"
            title="Nueva conversación"
          >
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
