from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.repository import LabeledSample, QueryRecord  # noqa: E402


class FakeRepository:
    def __init__(self, samples: list[LabeledSample] | None = None, records: list[QueryRecord] | None = None):
        self.samples = samples or []
        self.records = records or []

    def labeled_samples(self) -> list[LabeledSample]:
        return list(self.samples)

    def queries(self, include_synthetic: bool, limit: int = 5000) -> list[QueryRecord]:
        rows = self.records if include_synthetic else [r for r in self.records if not r.synthetic]
        return rows[:limit]


def make_labeled_samples(n: int = 240, seed: int = 7) -> list[LabeledSample]:
    """La probabilidad de feedback positivo depende de la similitud del mejor
    fragmento (patrón conocido) y de nada más."""
    rng = random.Random(seed)
    samples = []
    for _ in range(n):
        top = rng.uniform(0.3, 0.8)
        avg = top - rng.uniform(0.05, 0.2)
        spread = rng.uniform(0.05, 0.3)
        above = sum(rng.random() < top for _ in range(6))
        p = 1 / (1 + math.exp(-14 * (top - 0.55)))
        samples.append(
            LabeledSample(
                features=[
                    top,
                    avg,
                    spread,
                    above,
                    rng.randint(1, 3),
                    rng.randint(3, 15),
                    rng.random() < 0.2,
                    rng.random() < 0.3,
                ],
                positive=rng.random() < p,
                synthetic=True,
            )
        )
    return samples


TOPIC_QUESTIONS = {
    "vacaciones": [
        "cuántos días de vacaciones tengo",
        "cómo pido vacaciones",
        "vacaciones pagadas por año",
        "puedo acumular vacaciones",
        "vacaciones en diciembre bodega",
        "anticipación para pedir vacaciones",
        "días de vacaciones adicionales",
        "vacaciones y días nimbus",
    ],
    "reembolsos": [
        "tope de reembolso por almuerzo",
        "cómo pido un reembolso de taxi",
        "reembolso de alojamiento",
        "plazo para pedir reembolso",
        "reembolso de cursos y certificaciones",
        "qué gastos no se reembolsan",
        "reembolso de equipamiento remoto",
        "cuándo pagan el reembolso",
    ],
    "licencias": [
        "cómo presento una licencia médica",
        "licencia médica por más de 15 días",
        "quién paga la licencia médica",
        "plazo para entregar la licencia",
        "licencia médica rechazada qué hago",
        "licencia por enfermedad de un hijo",
        "licencia médica y vacaciones",
        "licencia médica electrónica",
    ],
}


def make_topic_records(dim: int = 64, seed: int = 3) -> list[QueryRecord]:
    """Tres temas bien separados; 'licencias' no está cubierto por los documentos
    (similitud baja y feedback negativo)."""
    rng = np.random.default_rng(seed)
    records: list[QueryRecord] = []
    for t, (topic, questions) in enumerate(TOPIC_QUESTIONS.items()):
        center = rng.normal(size=dim)
        center /= np.linalg.norm(center)
        uncovered = topic == "licencias"
        for i, q in enumerate(questions):
            emb = center + rng.normal(scale=0.15, size=dim)
            records.append(
                QueryRecord(
                    id=f"{t}-{i}",
                    question=q,
                    embedding=emb.astype(np.float32),
                    top_similarity=float(rng.uniform(0.3, 0.42) if uncovered else rng.uniform(0.6, 0.78)),
                    feedback=(-1 if uncovered else 1) if i % 2 == 0 else None,
                    synthetic=i % 3 == 0,
                    latency_ms=1200 + i * 10,
                )
            )
    return records


@pytest.fixture
def labeled_samples() -> list[LabeledSample]:
    return make_labeled_samples()


@pytest.fixture
def topic_records() -> list[QueryRecord]:
    return make_topic_records()
