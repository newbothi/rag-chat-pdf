"""Integración real con SQL Server 2025: el repositorio (pyodbc) lee lo que la
app escribe en dbo.Queries, incluido el tipo VECTOR.

Requiere la base de pruebas creada con `node scripts/test-db.mjs` y las
variables TEST_DB_* (en CI vienen del workflow; en local, de .env.test.local).
Sin ellas, estos tests se omiten.
"""

from __future__ import annotations

import json
import os
import uuid

import numpy as np
import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient

from app.confidence import ConfidenceModel
from app.config import PROJECT_ROOT, build_connection_string, settings
from app.main import create_app
from app.repository import SqlServerRepository
from app.schemas import FEATURE_NAMES

load_dotenv(PROJECT_ROOT / ".env.test.local")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.getenv("TEST_DB_USER"), reason="TEST_DB_* no configurado"),
]


@pytest.fixture(scope="module")
def connection_string() -> str:
    return build_connection_string(
        server=os.getenv("TEST_DB_SERVER", "localhost"),
        instance=os.getenv("TEST_DB_INSTANCE", ""),
        port=os.getenv("TEST_DB_PORT", "1433"),
        database=os.getenv("TEST_DB_NAME", "RagChat_Test"),
        user=os.environ["TEST_DB_USER"],
        password=os.environ["TEST_DB_PASSWORD"],
        trust_cert=True,
        driver=settings.odbc_driver,
    )


@pytest.fixture
def db(connection_string):
    import pyodbc

    conn = pyodbc.connect(connection_string, autocommit=True)
    conn.cursor().execute("DELETE FROM dbo.Queries")
    yield conn
    conn.cursor().execute("DELETE FROM dbo.Queries")
    conn.close()


def insert(db, *, question: str, top: float, feedback: int | None, synthetic: bool, seed: int) -> str:
    """Inserta una fila con las mismas columnas que escribe lib/analytics.ts (logQuery)."""
    query_id = str(uuid.uuid4())
    embedding = np.random.default_rng(seed).normal(size=1024)
    db.cursor().execute(
        """
        INSERT INTO dbo.Queries (
            Id, Question, SearchQuery, Embedding, TopSimilarity, AvgSimilarity, SimilaritySpread,
            ChunksAboveThreshold, DistinctPages, QuestionWords, IsFollowUp, HasDocumentFilter,
            LatencyMs, Feedback, IsSynthetic
        )
        VALUES (?, ?, ?, CAST(? AS VECTOR(1024)), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        query_id, question, question, json.dumps(embedding.tolist()),
        top, top - 0.1, 0.2, 3, 2, len(question.split()), 1, 0, 1500, feedback, 1 if synthetic else 0,
    )  # fmt: skip
    return query_id


def test_labeled_samples_reads_features_in_contract_order(db, connection_string):
    insert(db, question="¿Cuántos días de vacaciones?", top=0.72, feedback=1, synthetic=False, seed=1)
    insert(db, question="¿Cómo presento una licencia?", top=0.35, feedback=-1, synthetic=True, seed=2)
    insert(db, question="Sin evaluar", top=0.6, feedback=None, synthetic=False, seed=3)

    samples = SqlServerRepository(connection_string).labeled_samples()

    assert len(samples) == 2  # solo las que tienen feedback
    by_label = {s.positive: s for s in samples}
    positive = by_label[True]
    assert len(positive.features) == len(FEATURE_NAMES)
    row = dict(zip(FEATURE_NAMES, positive.features, strict=True))
    assert row["top_similarity"] == pytest.approx(0.72)
    assert row["avg_similarity"] == pytest.approx(0.62)
    assert row["chunks_above_threshold"] == 3
    assert row["is_follow_up"] == 1 and row["has_document_filter"] == 0
    assert positive.synthetic is False and by_label[False].synthetic is True


def test_queries_parses_vector_embeddings(db, connection_string):
    insert(db, question="Real", top=0.7, feedback=None, synthetic=False, seed=4)
    insert(db, question="Sintética", top=0.4, feedback=-1, synthetic=True, seed=5)
    repo = SqlServerRepository(connection_string)

    records = repo.queries(include_synthetic=True)

    assert {r.question for r in records} == {"Real", "Sintética"}
    for r in records:
        assert r.embedding.shape == (1024,)
        assert np.isfinite(r.embedding).all()
        assert r.latency_ms == 1500
    assert [r.question for r in repo.queries(include_synthetic=False)] == ["Real"]


def test_report_endpoint_against_real_database(db, connection_string):
    for i in range(8):
        insert(db, question=f"Pregunta de vacaciones {i}", top=0.7, feedback=1, synthetic=False, seed=10 + i)
    app = create_app(SqlServerRepository(connection_string), ConfidenceModel(0.5), api_key="k")

    with TestClient(app) as client:
        body = client.get("/report", headers={"X-Analytics-Key": "k"}).json()

    assert body["overview"]["total_queries"] == 8
    assert body["overview"]["positive_rate"] == 1.0
    assert body["topics"]["clusters"] >= 1
    assert body["confidence"]["model"] == "heuristic"  # 8 < mínimo para entrenar
