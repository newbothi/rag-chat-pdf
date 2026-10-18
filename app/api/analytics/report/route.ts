import { AnalyticsUnavailableError, getReport } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/analytics/report — proxy al servicio Python (la clave nunca llega al navegador). */
export async function GET(req: Request) {
  const includeSynthetic = new URL(req.url).searchParams.get('synthetic') !== 'false';
  try {
    return Response.json(await getReport(includeSynthetic));
  } catch (err) {
    const status = err instanceof AnalyticsUnavailableError ? 503 : 500;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
