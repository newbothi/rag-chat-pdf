import { AnalyticsUnavailableError, retrain } from '@/lib/analytics';

export const runtime = 'nodejs';

/** POST /api/analytics/train — reentrena el modelo de confianza y devuelve sus métricas. */
export async function POST() {
  try {
    return Response.json(await retrain());
  } catch (err) {
    const status = err instanceof AnalyticsUnavailableError ? 503 : 500;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
