'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AnalyticsReport } from '@/lib/analytics';

type Report = AnalyticsReport;
type Topic = Report['topics']['topics'][number];
type Status = Topic['status'];

const STATUS: Record<Status, { label: string; icon: string; color: string }> = {
  sin_cobertura: { label: 'Sin cobertura', icon: '✕', color: 'var(--status-critical)' },
  parcial: { label: 'Parcial', icon: '!', color: 'var(--status-warning)' },
  cubierto: { label: 'Cubierto', icon: '✓', color: 'var(--status-good)' },
};

const pct = (v: number | null | undefined, digits = 0) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);
const num = (v: number | null | undefined, digits = 2) => (v == null ? '—' : v.toFixed(digits));

export default function AnalyticsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [includeSynthetic, setIncludeSynthetic] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/analytics/report?synthetic=${includeSynthetic}`, { cache: 'no-store' }).catch(
      () => null,
    );
    if (!res) setError('No se pudo contactar al servidor.');
    else if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? `Error ${res.status}`);
    else setReport(await res.json());
    setLoading(false);
  }, [includeSynthetic]);

  useEffect(() => {
    load();
  }, [load]);

  async function retrain() {
    setTraining(true);
    const res = await fetch('/api/analytics/train', { method: 'POST' }).catch(() => null);
    setTraining(false);
    if (!res?.ok) {
      setError((await res?.json().catch(() => ({})))?.error ?? 'No se pudo reentrenar.');
      return;
    }
    await load();
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <a href="/" className="text-sm text-indigo-600 hover:underline">
            ← Volver al chat
          </a>
          <h1 className="mt-1 text-2xl font-semibold">Analítica del chat</h1>
          <p className="text-sm text-zinc-500">
            Qué preguntan los usuarios, qué temas no cubren los documentos y qué tan confiables son las respuestas.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={includeSynthetic} onChange={(e) => setIncludeSynthetic(e.target.checked)} />
            Incluir datos sintéticos
          </label>
          <button
            type="button"
            onClick={retrain}
            disabled={training}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:border-indigo-400 disabled:opacity-50 dark:border-zinc-700"
          >
            {training ? 'Entrenando…' : 'Reentrenar modelo'}
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-50"
          >
            {loading ? 'Cargando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      {error && <ServiceError message={error} />}

      {report && (
        <>
          <Overview overview={report.overview} />
          <Topics topics={report.topics} />
          <ConfidenceModel confidence={report.confidence} />
        </>
      )}
    </main>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-[var(--viz-surface)] p-4 dark:border-zinc-800 md:p-5">
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ServiceError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <p className="font-semibold">No se pudo cargar la analítica</p>
      <p className="mt-1">{message}</p>
      <p className="mt-2 text-red-700 dark:text-red-300">
        Revisa que el servicio Python esté corriendo (<code>npm run analytics</code> o <code>npm run dev:all</code>),
        que <code>ANALYTICS_API_KEY</code> sea la misma para Node y Python en <code>.env.local</code>, y que ejecutaste{' '}
        <code>db/002-analytics.sql</code>.
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-[var(--viz-surface)] p-4 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function Overview({ overview: o }: { overview: Report['overview'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Stat
        label="Consultas"
        value={String(o.total_queries)}
        hint={o.synthetic_queries ? `${o.synthetic_queries} sintéticas` : undefined}
      />
      <Stat
        label="Con feedback"
        value={String(o.with_feedback)}
        hint={o.total_queries ? `${pct(o.with_feedback / o.total_queries)} del total` : undefined}
      />
      <Stat label="Respuestas útiles" value={pct(o.positive_rate)} hint="de las evaluadas" />
      <Stat label="Sin buena cobertura" value={pct(o.low_coverage_rate)} hint="mejor fragmento bajo el umbral" />
      <Stat
        label="Latencia media"
        value={o.avg_latency_ms == null ? '—' : `${(o.avg_latency_ms / 1000).toFixed(1)} s`}
      />
    </div>
  );
}

// ---------------- Temas ----------------

function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-700">
      <span
        aria-hidden
        className="grid h-3.5 w-3.5 place-items-center rounded-full text-[9px] font-bold text-white"
        style={{ background: s.color }}
      >
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}

function Topics({ topics: t }: { topics: Report['topics'] }) {
  if (!t.topics.length) {
    return (
      <Card title="Temas que preguntan los usuarios">
        <p className="text-sm text-zinc-500">{t.reason ?? 'Aún no hay datos.'}</p>
      </Card>
    );
  }
  const maxShare = Math.max(...t.topics.map((x) => x.share));
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <Card
          title="Temas que preguntan los usuarios"
          subtitle={`${t.clusters} temas detectados (KMeans sobre embeddings, silueta ${num(t.silhouette)}). Ordenados por prioridad: frecuentes, mal cubiertos y mal evaluados primero.`}
        >
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {t.topics.map((topic) => (
              <li key={topic.id} className="py-3 first:pt-0">
                <details>
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">{topic.label}</p>
                      <StatusBadge status={topic.status} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {topic.keywords.map((k) => (
                        <span
                          key={k}
                          className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2" title={`${topic.size} preguntas`}>
                      <div className="h-2 flex-1">
                        <div
                          className="h-2 rounded-r"
                          style={{ width: `${(topic.share / maxShare) * 100}%`, background: 'var(--viz-seq)' }}
                        />
                      </div>
                      <span className="w-28 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                        {pct(topic.share)} · {topic.size} preg.
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      Similitud media {num(topic.avg_top_similarity)} · {pct(topic.low_coverage_rate)} bajo el umbral ·{' '}
                      {topic.feedback_count
                        ? `${pct(topic.negative_rate)} de 👎 (${topic.feedback_count} evaluadas)`
                        : 'sin feedback'}
                    </p>
                  </summary>
                  <ul className="mt-2 space-y-1 rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
                    {topic.examples.map((e) => (
                      <li key={e.question} className="flex justify-between gap-2">
                        <span>
                          {e.feedback === 1 ? '👍 ' : e.feedback === -1 ? '👎 ' : ''}
                          {e.question}
                        </span>
                        <span className="tabular-nums text-zinc-500">{num(e.top_similarity)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="lg:col-span-2">
        <Card
          title="Mapa de preguntas"
          subtitle="Proyección 2D (PCA) de los embeddings. Preguntas cercanas tratan el mismo tema. Pasa el cursor por un punto para verla."
        >
          <TopicMap topics={t.topics} points={t.points} />
        </Card>
      </div>
    </div>
  );
}

function TopicMap({ topics, points }: { topics: Topic[]; points: Report['topics']['points'] }) {
  const W = 320;
  const H = 260;
  const pad = 12;
  const statusOf = new Map(topics.map((t) => [t.id, t.status]));
  const labelOf = new Map(topics.map((t) => [t.id, t.label]));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (W - 2 * pad);
  const sy = (y: number) => H - pad - ((y - minY) / (maxY - minY || 1)) * (H - 2 * pad);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Mapa de preguntas por tema">
        <rect x={0} y={0} width={W} height={H} fill="none" stroke="var(--viz-grid)" />
        {points.map((p, i) => {
          const status = statusOf.get(p.topic) ?? 'cubierto';
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: lista estática por render; dos preguntas pueden repetirse
            <g key={i}>
              <circle cx={sx(p.x)} cy={sy(p.y)} r={9} fill="transparent">
                <title>{`${p.question}\nTema: ${labelOf.get(p.topic)}\nSimilitud: ${p.top_similarity.toFixed(2)}`}</title>
              </circle>
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={4.5}
                fill={STATUS[status].color}
                stroke="var(--viz-surface)"
                strokeWidth={2}
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-300">
        {(Object.keys(STATUS) as Status[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS[s].color }} aria-hidden />
            {STATUS[s].label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------- Modelo de confianza ----------------

function ConfidenceModel({ confidence: c }: { confidence: Report['confidence'] }) {
  if (c.model === 'heuristic') {
    const progress = Math.min(1, c.labeled_samples / c.min_samples_required);
    return (
      <Card
        title="Modelo de confianza"
        subtitle="Estimación inicial por similitud: aún no hay suficiente feedback para entrenar."
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{c.reason}</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 rounded bg-zinc-200 dark:bg-zinc-800">
            <div className="h-2 rounded" style={{ width: `${progress * 100}%`, background: 'var(--viz-seq)' }} />
          </div>
          <span className="text-xs tabular-nums text-zinc-500">
            {c.labeled_samples}/{c.min_samples_required} respuestas evaluadas
          </span>
        </div>
      </Card>
    );
  }

  const maxAbs = Math.max(...c.coefficients.map((x) => Math.abs(x.value)), 1e-6);
  const cm = c.confusion ?? { true_positive: 0, false_positive: 0, true_negative: 0, false_negative: 0 };
  const lift = c.cv_auc != null && c.baseline_auc != null ? c.cv_auc - c.baseline_auc : null;

  return (
    <Card
      title="Modelo de confianza (regresión logística)"
      subtitle={`Predice si una respuesta será útil antes de generarla, a partir de cómo salió la búsqueda. Entrenado con ${c.labeled_samples} respuestas evaluadas (${c.positive_samples} 👍, ${c.negative_samples} 👎${c.synthetic_samples ? `, ${c.synthetic_samples} sintéticas` : ''}) · validación cruzada de ${c.cv_folds} particiones.`}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="AUC (validación cruzada)" value={num(c.cv_auc)} hint="0,5 = azar · 1 = perfecto" />
        <Stat
          label="Baseline: solo similitud"
          value={num(c.baseline_auc)}
          hint={
            lift == null
              ? undefined
              : `El modelo completo ${lift >= 0 ? 'suma' : 'resta'} ${Math.abs(lift).toFixed(2)} de AUC`
          }
        />
        <Stat label="Exactitud" value={pct(c.cv_accuracy)} hint="umbral 0,5" />
        <Stat label="Brier" value={num(c.cv_brier, 3)} hint="error de probabilidad (menor es mejor)" />
      </div>

      <div className="mt-5 grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <h3 className="text-sm font-medium">Peso de cada variable</h3>
          <p className="text-xs text-zinc-500">
            Coeficientes con variables estandarizadas. Azul sube la confianza; rojo la baja.
          </p>
          <ul className="mt-3 space-y-2">
            {c.coefficients.map((coef) => {
              const w = (Math.abs(coef.value) / maxAbs) * 50;
              const positive = coef.value >= 0;
              return (
                <li
                  key={coef.feature}
                  className="grid grid-cols-[minmax(0,11rem)_1fr_3.5rem] items-center gap-2 text-xs"
                >
                  <span className="truncate text-zinc-600 dark:text-zinc-300" title={coef.label}>
                    {coef.label}
                  </span>
                  <div className="relative h-3">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--viz-axis)]" />
                    <div
                      className={`absolute inset-y-0 ${positive ? 'rounded-r' : 'rounded-l'}`}
                      style={{
                        left: positive ? '50%' : `${50 - w}%`,
                        width: `${w}%`,
                        background: positive ? 'var(--viz-pos)' : 'var(--viz-neg)',
                      }}
                    />
                  </div>
                  <span className="text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                    {coef.value >= 0 ? '+' : ''}
                    {coef.value.toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-medium">Matriz de confusión</h3>
          <p className="text-xs text-zinc-500">Predicciones fuera de la muestra (validación cruzada).</p>
          <table className="mt-3 w-full text-center text-xs tabular-nums">
            <thead>
              <tr className="text-zinc-500">
                <th />
                <th className="pb-1 font-normal">Predijo 👍</th>
                <th className="pb-1 font-normal">Predijo 👎</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="pr-2 text-right font-normal text-zinc-500">Fue 👍</th>
                <td className="rounded bg-zinc-100 p-3 text-base font-semibold dark:bg-zinc-800">{cm.true_positive}</td>
                <td className="p-3 text-base">{cm.false_negative}</td>
              </tr>
              <tr>
                <th className="pr-2 text-right font-normal text-zinc-500">Fue 👎</th>
                <td className="p-3 text-base">{cm.false_positive}</td>
                <td className="rounded bg-zinc-100 p-3 text-base font-semibold dark:bg-zinc-800">{cm.true_negative}</td>
              </tr>
            </tbody>
          </table>
          {c.trained_at && (
            <p className="mt-3 text-xs text-zinc-500">Entrenado: {new Date(c.trained_at).toLocaleString('es-CL')}</p>
          )}
        </div>
      </div>
    </Card>
  );
}
