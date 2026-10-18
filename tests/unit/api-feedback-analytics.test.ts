import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/analytics')>();
  return {
    ...real,
    saveFeedback: vi.fn(),
    retrainInBackground: vi.fn(),
    getReport: vi.fn(),
    retrain: vi.fn(),
  };
});

import { GET as reportGet } from '@/app/api/analytics/report/route';
import { POST as reportTrain } from '@/app/api/analytics/train/route';
import { POST as feedback } from '@/app/api/feedback/route';
import * as analytics from '@/lib/analytics';

const mocked = vi.mocked(analytics);
const QUERY_ID = '6f1c2b8e-3a4d-4e5f-8a9b-0c1d2e3f4a5b';

const post = (body: unknown) =>
  new Request('http://app.test/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe('POST /api/feedback', () => {
  it('guarda el feedback y reentrena en segundo plano', async () => {
    mocked.saveFeedback.mockResolvedValue(true);

    const res = await feedback(post({ queryId: QUERY_ID, value: -1 }));

    expect(res.status).toBe(204);
    expect(mocked.saveFeedback).toHaveBeenCalledWith(QUERY_ID, -1);
    expect(mocked.retrainInBackground).toHaveBeenCalledOnce();
  });

  it('responde 404 si la consulta no existe y no reentrena', async () => {
    mocked.saveFeedback.mockResolvedValue(false);
    const res = await feedback(post({ queryId: QUERY_ID, value: 1 }));
    expect(res.status).toBe(404);
    expect(mocked.retrainInBackground).not.toHaveBeenCalled();
  });

  it.each([
    ['valor fuera de rango', { queryId: QUERY_ID, value: 5 }],
    ['valor como texto', { queryId: QUERY_ID, value: '1' }],
    ['id que no es UUID', { queryId: "1'; DROP TABLE dbo.Queries;--", value: 1 }],
    ['sin id', { value: 1 }],
    ['JSON inválido', '{no es json'],
  ])('rechaza datos inválidos: %s', async (_, body) => {
    const res = await feedback(post(body));
    expect(res.status).toBe(400);
    expect(mocked.saveFeedback).not.toHaveBeenCalled();
  });
});

describe('proxy de analítica', () => {
  it('GET /api/analytics/report devuelve el reporte e incluye sintéticos por defecto', async () => {
    mocked.getReport.mockResolvedValue({ ok: true } as never);
    const res = await reportGet(new Request('http://app.test/api/analytics/report'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocked.getReport).toHaveBeenCalledWith(true);
  });

  it('GET /api/analytics/report?synthetic=false los excluye', async () => {
    mocked.getReport.mockResolvedValue({} as never);
    await reportGet(new Request('http://app.test/api/analytics/report?synthetic=false'));
    expect(mocked.getReport).toHaveBeenCalledWith(false);
  });

  it('responde 503 si el servicio Python no está disponible', async () => {
    mocked.getReport.mockRejectedValue(new analytics.AnalyticsUnavailableError('caído'));
    const res = await reportGet(new Request('http://app.test/api/analytics/report'));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('caído');
  });

  it('responde 500 ante errores inesperados', async () => {
    mocked.retrain.mockRejectedValue(new Error('boom'));
    const res = await reportTrain();
    expect(res.status).toBe(500);
  });

  it('POST /api/analytics/train devuelve las métricas', async () => {
    mocked.retrain.mockResolvedValue({ report: { model: 'logistic' } } as never);
    const res = await reportTrain();
    expect(res.status).toBe(200);
    expect((await res.json()).report.model).toBe('logistic');
  });
});
