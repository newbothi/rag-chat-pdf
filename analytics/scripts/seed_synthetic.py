"""Genera consultas sintéticas para probar el panel de analítica.

Las preguntas son inventadas, pero todo lo demás es REAL: se calculan sus
embeddings con tu servidor (LM Studio u Ollama) y se buscan en los documentos
que subiste, con la misma consulta que usa la app. Solo el feedback es
simulado, con una regla conocida:

    P(👍) = sigmoide(12·(similitud_máx − 0,55) + 0,4·[≥2 fragmentos relevantes] − 0,3)

Así se puede comprobar que el modelo de confianza aprende ese patrón y que el
clustering detecta los temas que el reglamento de ejemplo NO cubre
(licencias médicas, sueldos, estacionamiento/casino).

Requisitos: haber subido docs/ejemplo/reglamento-interno-nimbus.pdf y tener el
servidor de embeddings corriendo.

Uso (desde la raíz del proyecto):
    npm run analytics:seed               # agrega ~75 consultas
    npm run analytics:seed -- --reset    # borra las sintéticas anteriores primero
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402

QUESTIONS: dict[str, list[str]] = {
    # --- Cubiertos por el reglamento de ejemplo ---
    "vacaciones": [
        "¿Cuántos días de vacaciones tengo al año?",
        "¿Con cuánta anticipación debo pedir las vacaciones?",
        "¿Qué son los días Nimbus?",
        "¿Puedo acumular los días Nimbus para el próximo año?",
        "¿Puedo tomar vacaciones en diciembre si trabajo en bodega?",
        "¿Dónde solicito mis vacaciones?",
        "¿Las vacaciones son pagadas?",
    ],
    "permisos": [
        "¿Cuántos días me dan si me caso?",
        "¿Qué permiso tengo por el nacimiento de mi hijo?",
        "¿Cuántos días de permiso hay por fallecimiento de un familiar?",
        "¿Me dan un día libre por cambio de casa?",
        "¿Tengo permiso para rendir mi examen de título?",
        "¿Los permisos por trámites personales son con goce de sueldo?",
    ],
    "remoto": [
        "¿Cuántos días puedo trabajar desde la casa?",
        "¿Qué días es obligatorio ir a la oficina?",
        "¿Hay un bono por trabajar remoto?",
        "¿Qué velocidad de internet necesito para el teletrabajo?",
        "¿Puedo trabajar remoto si estoy en período de prueba?",
        "¿Qué áreas pueden tener modalidad híbrida?",
    ],
    "reembolsos": [
        "¿Cuál es el tope para almorzar en un viaje de trabajo?",
        "¿Cuánto me reembolsan por un taxi?",
        "¿Cuál es el plazo para pedir un reembolso?",
        "¿Necesito aprobación previa para reembolsar un curso?",
        "¿Qué gastos no se reembolsan?",
        "¿Cuándo me pagan los reembolsos?",
        "¿Cuánto cubren por alojamiento fuera de Santiago?",
    ],
    "seguridad": [
        "¿Qué hago si me roban el notebook?",
        "¿Cada cuánto debo cambiar mi contraseña?",
        "¿Puedo instalar programas en el computador de la empresa?",
        "¿Puedo usar ChatGPT con documentos confidenciales?",
        "¿Es obligatorio el doble factor de autenticación?",
    ],
    "jornada": [
        "¿A qué hora puedo entrar a trabajar?",
        "¿Cuántas horas se trabaja a la semana?",
        "¿Cómo se pagan las horas extra?",
        "¿A qué hora termina la jornada los viernes?",
        "¿Cuánto dura la hora de colación?",
    ],
    "beneficios": [
        "¿Qué porcentaje del seguro de salud paga la empresa?",
        "¿Me dan algo para mi cumpleaños?",
        "¿Cuánto es el aguinaldo?",
        "¿Hay descuento en el gimnasio?",
        "¿Existe una beca para estudiar?",
    ],
    "evaluacion": [
        "¿Cuándo son las evaluaciones de desempeño?",
        "¿Qué nota necesito para optar a un aumento?",
        "¿Qué se considera en la evaluación de desempeño?",
    ],
    # --- NO cubiertos por el reglamento de ejemplo ---
    "licencias": [
        "¿Cómo presento una licencia médica?",
        "¿Quién paga los primeros días de licencia médica?",
        "¿Cuál es el plazo para entregar la licencia médica?",
        "¿Qué hago si me rechazan la licencia médica?",
        "¿Hay licencia por enfermedad grave de un hijo?",
        "¿La licencia médica afecta mis vacaciones?",
        "¿Aceptan licencia médica electrónica?",
    ],
    "sueldos": [
        "¿Qué día pagan el sueldo?",
        "¿Dónde descargo mi liquidación de sueldo?",
        "¿Puedo pedir un anticipo de sueldo?",
        "¿Cuál es el sueldo base de un analista?",
        "¿Cómo cambio la cuenta donde me depositan el sueldo?",
        "¿Cuándo pagan la gratificación?",
    ],
    "instalaciones": [
        "¿Hay estacionamiento para los trabajadores?",
        "¿La oficina tiene casino o comedor?",
        "¿Dónde dejo la bicicleta?",
        "¿Hay duchas en la oficina?",
        "¿Puedo llevar a mi mascota a la oficina?",
    ],
}

TOP_K = 6

# pyodbc envía los textos largos (como un embedding en JSON) como ntext, y SQL Server no
# permite ntext → VECTOR. Por eso se convierte primero a NVARCHAR(MAX): CAST(CAST(? AS NVARCHAR(MAX)) AS VECTOR(1024)).


def connect():
    import pyodbc

    return pyodbc.connect(settings.connection_string, timeout=5)


def embed(texts: list[str]) -> list[list[float]]:
    url = settings.embedding_base_url.rstrip("/") + "/embeddings"
    resp = httpx.post(url, json={"model": settings.embedding_model, "input": texts}, timeout=120)
    resp.raise_for_status()
    data = sorted(resp.json()["data"], key=lambda d: d["index"])
    return [d["embedding"] for d in data]


def retrieve(cur, vector_json: str) -> list[tuple[int, float]]:
    rows = cur.execute(
        """
        DECLARE @q VECTOR(1024) = CAST(CAST(? AS NVARCHAR(MAX)) AS VECTOR(1024));
        SELECT TOP (?) c.Page, 1 - VECTOR_DISTANCE('cosine', c.Embedding, @q) AS Similarity
        FROM dbo.Chunks c
        JOIN dbo.Documents d ON d.Id = c.DocumentId
        WHERE d.Status = 'ready'
        ORDER BY VECTOR_DISTANCE('cosine', c.Embedding, @q);
        """,
        vector_json,
        TOP_K,
    ).fetchall()
    return [(int(r[0]), float(r[1])) for r in rows]


def simulate_feedback(rng: random.Random, top: float, above: int) -> int | None:
    if rng.random() < 0.25:  # una de cada cuatro respuestas queda sin evaluar
        return None
    z = 12 * (top - 0.55) + 0.4 * (above >= 2) - 0.3
    return 1 if rng.random() < 1 / (1 + math.exp(-z)) else -1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="borra las consultas sintéticas existentes")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    rng = random.Random(args.seed)

    questions = [q for qs in QUESTIONS.values() for q in qs]
    threshold = settings.relevance_threshold

    with connect() as conn:
        cur = conn.cursor()
        ready = cur.execute("SELECT COUNT(*) FROM dbo.Documents WHERE Status = 'ready'").fetchone()[0]
        if ready == 0:
            sys.exit("No hay documentos listos. Sube primero docs/ejemplo/reglamento-interno-nimbus.pdf en la app.")

        if args.reset:
            deleted = cur.execute("DELETE FROM dbo.Queries WHERE IsSynthetic = 1").rowcount
            print(f"Borradas {deleted} consultas sintéticas anteriores.")

        print(f"Calculando embeddings de {len(questions)} preguntas con {settings.embedding_model}…")
        embeddings = embed(questions)

        now = datetime.now(timezone.utc)
        stats = {"pos": 0, "neg": 0, "none": 0}
        for question, embedding in zip(questions, embeddings, strict=True):
            vector_json = json.dumps(embedding)
            hits = retrieve(cur, vector_json)
            if not hits:
                continue
            sims = [s for _, s in hits]
            relevant_pages = {p for p, s in hits if s >= threshold}
            above = sum(s >= threshold for s in sims)
            feedback = simulate_feedback(rng, sims[0], above)
            stats["pos" if feedback == 1 else "neg" if feedback == -1 else "none"] += 1

            cur.execute(
                """
                INSERT INTO dbo.Queries (
                    Id, Question, SearchQuery, Embedding,
                    TopSimilarity, AvgSimilarity, SimilaritySpread, ChunksAboveThreshold, DistinctPages,
                    QuestionWords, IsFollowUp, HasDocumentFilter,
                    Answer, LatencyMs, Feedback, FeedbackAt, IsSynthetic, CreatedAt
                )
                VALUES (NEWID(), ?, ?, CAST(CAST(? AS NVARCHAR(MAX)) AS VECTOR(1024)), ?, ?, ?, ?, ?, ?, 0, 0,
                        N'(respuesta sintética)', ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE SYSUTCDATETIME() END, 1, ?)
                """,
                question,
                question,
                vector_json,
                sims[0],
                sum(sims) / len(sims),
                sims[0] - sims[-1],
                above,
                len(relevant_pages),
                len(question.split()),
                rng.randint(900, 4500),
                feedback,
                feedback,
                (now - timedelta(days=rng.uniform(0, 30))).replace(tzinfo=None),
            )
        conn.commit()

    total = sum(stats.values())
    print(f"Listo: {total} consultas sintéticas ({stats['pos']} 👍, {stats['neg']} 👎, {stats['none']} sin evaluar).")
    print("Reentrena el modelo desde el panel (botón «Reentrenar») o reinicia el servicio de análisis.")


if __name__ == "__main__":
    main()
