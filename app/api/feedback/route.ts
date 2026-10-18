import { z } from 'zod';
import { retrainInBackground, saveFeedback } from '@/lib/analytics';

export const runtime = 'nodejs';

const FeedbackSchema = z.object({
  queryId: z.uuid(),
  value: z.union([z.literal(1), z.literal(-1)]),
});

/** POST /api/feedback — 👍 (1) o 👎 (-1) sobre una respuesta; reentrena el modelo de confianza en segundo plano. */
export async function POST(req: Request) {
  const parsed = FeedbackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Datos inválidos.' }, { status: 400 });
  }

  const found = await saveFeedback(parsed.data.queryId, parsed.data.value);
  if (!found) {
    return Response.json({ error: 'Consulta no encontrada.' }, { status: 404 });
  }

  retrainInBackground();
  return new Response(null, { status: 204 });
}
