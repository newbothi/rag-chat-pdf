"""Acceso a datos (SQL directo con pyodbc). El resto del servicio depende del
protocolo `Repository`, así los tests usan un repositorio en memoria."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from .config import settings
from .schemas import FEATURE_NAMES


@dataclass
class LabeledSample:
    features: list[float]  # en el orden de FEATURE_NAMES
    positive: bool
    synthetic: bool


@dataclass
class QueryRecord:
    id: str
    question: str
    embedding: np.ndarray
    top_similarity: float
    feedback: int | None
    synthetic: bool
    latency_ms: int | None


class Repository(Protocol):
    def labeled_samples(self) -> list[LabeledSample]: ...
    def queries(self, include_synthetic: bool, limit: int = 5000) -> list[QueryRecord]: ...


_FEATURE_COLUMNS = {
    "top_similarity": "TopSimilarity",
    "avg_similarity": "AvgSimilarity",
    "similarity_spread": "SimilaritySpread",
    "chunks_above_threshold": "ChunksAboveThreshold",
    "distinct_pages": "DistinctPages",
    "question_words": "QuestionWords",
    "is_follow_up": "CAST(IsFollowUp AS INT)",
    "has_document_filter": "CAST(HasDocumentFilter AS INT)",
}


class SqlServerRepository:
    def __init__(self, connection_string: str | None = None):
        self._cs = connection_string or settings.connection_string

    def _connect(self):
        import pyodbc  # import diferido: los tests no necesitan el driver ODBC

        return pyodbc.connect(self._cs, timeout=5)

    def labeled_samples(self) -> list[LabeledSample]:
        # Los nombres de columna salen de un diccionario fijo del código, nunca de la entrada del usuario
        columns = ", ".join(_FEATURE_COLUMNS[name] for name in FEATURE_NAMES)
        sql = (
            f"SELECT {columns}, Feedback, CAST(IsSynthetic AS INT) "  # noqa: S608
            "FROM dbo.Queries WHERE Feedback IS NOT NULL"
        )
        with self._connect() as conn:
            rows = conn.cursor().execute(sql).fetchall()
        n = len(FEATURE_NAMES)
        return [
            LabeledSample(
                features=[float(v) for v in row[:n]],
                positive=row[n] == 1,
                synthetic=bool(row[n + 1]),
            )
            for row in rows
        ]

    def queries(self, include_synthetic: bool, limit: int = 5000) -> list[QueryRecord]:
        # El tipo VECTOR se convierte a su representación JSON '[0.1, ...]'
        sql = """
            SELECT TOP (?) CAST(Id AS VARCHAR(36)), Question, CAST(Embedding AS NVARCHAR(MAX)),
                   TopSimilarity, Feedback, CAST(IsSynthetic AS INT), LatencyMs
            FROM dbo.Queries
            WHERE (? = 1 OR IsSynthetic = 0)
            ORDER BY CreatedAt DESC
        """
        with self._connect() as conn:
            rows = conn.cursor().execute(sql, limit, 1 if include_synthetic else 0).fetchall()
        return [
            QueryRecord(
                id=row[0],
                question=row[1],
                embedding=np.asarray(json.loads(row[2]), dtype=np.float32),
                top_similarity=float(row[3]),
                feedback=row[4],
                synthetic=bool(row[5]),
                latency_ms=row[6],
            )
            for row in rows
        ]
