'use client';

import { useRef, useState } from 'react';
import type { DocumentRow } from '@/lib/types';

type Props = {
  documents: DocumentRow[];
  selected: string[];
  onToggle: (id: string) => void;
  onChange: () => void;
};

const formatSize = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

export function DocumentPanel({ documents, selected, onToggle, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      setUploading(file.name);
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/documents', { method: 'POST', body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(`${file.name}: ${data.error ?? 'Error al subir'}`);
      }
      onChange();
    }
    setUploading(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar este documento y todos sus fragmentos?')) return;
    await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    if (selected.includes(id)) onToggle(id);
    onChange();
  }

  return (
    <aside className="flex h-full w-full flex-col gap-4 border-r border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900 md:w-80">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">📄 Chat con tus PDFs</h1>
        <a
          href="/analytics"
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          📊 Analítica
        </a>
      </div>

      <button
        type="button"
        disabled={uploading !== null}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files);
        }}
        className={`w-full cursor-pointer rounded-lg border-2 border-dashed p-5 text-center text-sm transition focus-visible:outline-2 focus-visible:outline-indigo-500 ${
          dragging
            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
            : 'border-zinc-300 hover:border-indigo-400 dark:border-zinc-700'
        }`}
      >
        {uploading ? (
          <span className="animate-pulse">Procesando {uploading}…</span>
        ) : (
          <>
            <strong>Arrastra PDFs aquí</strong>
            <br />o haz clic para elegir
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(e) => upload(e.target.files)}
      />

      {error && (
        <p className="rounded bg-red-100 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      <div className="text-xs text-zinc-500">
        {selected.length
          ? `Preguntando sobre ${selected.length} documento(s) seleccionado(s)`
          : 'Preguntando sobre todos los documentos'}
      </div>

      <ul className="flex-1 space-y-2 overflow-y-auto">
        {documents.map((d) => (
          <li
            key={d.id}
            className="flex items-start gap-2 rounded-md border border-zinc-200 bg-white p-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <input
              type="checkbox"
              className="mt-1"
              disabled={d.status !== 'ready'}
              checked={selected.includes(d.id)}
              onChange={() => onToggle(d.id)}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" title={d.name}>
                {d.name}
              </p>
              <p className="text-xs text-zinc-500">
                {d.status === 'ready' && `${d.pages} pág. · ${d.chunks} fragmentos · ${formatSize(d.sizeBytes)}`}
                {d.status === 'processing' && 'Procesando…'}
                {d.status === 'error' && <span className="text-red-600">Error: {d.error}</span>}
              </p>
            </div>
            <button
              type="button"
              onClick={() => remove(d.id)}
              className="text-zinc-400 hover:text-red-600"
              title="Eliminar"
              aria-label={`Eliminar ${d.name}`}
            >
              ✕
            </button>
          </li>
        ))}
        {documents.length === 0 && <li className="text-sm text-zinc-500">Aún no hay documentos.</li>}
      </ul>
    </aside>
  );
}
