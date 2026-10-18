"""Contrato del servicio. FastAPI lo exporta a OpenAPI y de ahí se generan los
tipos de TypeScript (lib/analytics-api.d.ts) que usa Next.js."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# El orden de esta lista define las columnas de la matriz de features del modelo.
FEATURE_NAMES: list[str] = [
    "top_similarity",
    "avg_similarity",
    "similarity_spread",
    "chunks_above_threshold",
    "distinct_pages",
    "question_words",
    "is_follow_up",
    "has_document_filter",
]

FEATURE_LABELS: dict[str, str] = {
    "top_similarity": "Similitud del mejor fragmento",
    "avg_similarity": "Similitud promedio",
    "similarity_spread": "Dispersión de similitudes",
    "chunks_above_threshold": "Fragmentos relevantes",
    "distinct_pages": "Páginas distintas",
    "question_words": "Largo de la pregunta (palabras)",
    "is_follow_up": "Es pregunta de seguimiento",
    "has_document_filter": "Filtra por documentos",
}


class QueryFeatures(BaseModel):
    """Métricas de la recuperación, conocidas ANTES de generar la respuesta."""

    top_similarity: float = Field(ge=-1, le=1)
    avg_similarity: float = Field(ge=-1, le=1)
    similarity_spread: float = Field(ge=0, le=2)
    chunks_above_threshold: int = Field(ge=0)
    distinct_pages: int = Field(ge=0)
    question_words: int = Field(ge=0)
    is_follow_up: bool
    has_document_filter: bool

    def as_row(self) -> list[float]:
        return [float(getattr(self, name)) for name in FEATURE_NAMES]


ConfidenceLevel = Literal["alta", "media", "baja"]
ModelKind = Literal["logistic", "heuristic"]


class ConfidencePrediction(BaseModel):
    probability: float = Field(ge=0, le=1, description="Probabilidad estimada de feedback positivo")
    level: ConfidenceLevel
    model: ModelKind


class Coefficient(BaseModel):
    feature: str
    label: str
    value: float = Field(description="Coeficiente con features estandarizadas (log-odds por desviación estándar)")


class ConfusionMatrix(BaseModel):
    true_positive: int
    false_positive: int
    true_negative: int
    false_negative: int


class ConfidenceReport(BaseModel):
    model: ModelKind
    trained_at: str | None
    labeled_samples: int
    positive_samples: int
    negative_samples: int
    synthetic_samples: int
    min_samples_required: int
    reason: str | None = Field(None, description="Por qué se usa la heurística, si aplica")
    cv_folds: int | None = None
    cv_auc: float | None = None
    baseline_auc: float | None = Field(None, description="AUC usando solo la similitud del mejor fragmento")
    cv_accuracy: float | None = None
    cv_brier: float | None = None
    confusion: ConfusionMatrix | None = None
    coefficients: list[Coefficient] = []


class TrainResponse(BaseModel):
    report: ConfidenceReport


class Overview(BaseModel):
    total_queries: int
    synthetic_queries: int
    with_feedback: int
    positive_rate: float | None
    avg_top_similarity: float | None
    avg_latency_ms: float | None
    low_coverage_rate: float | None = Field(
        None, description="Proporción de consultas cuyo mejor fragmento no supera el umbral de cobertura"
    )


class TopicExample(BaseModel):
    question: str
    top_similarity: float
    feedback: int | None


class Topic(BaseModel):
    id: int
    label: str = Field(description="Pregunta más representativa del grupo")
    keywords: list[str]
    size: int
    share: float
    avg_top_similarity: float
    low_coverage_rate: float
    feedback_count: int
    negative_rate: float | None
    status: Literal["sin_cobertura", "parcial", "cubierto"]
    gap_score: float
    examples: list[TopicExample]


class TopicPoint(BaseModel):
    x: float
    y: float
    topic: int
    question: str
    top_similarity: float


class TopicsReport(BaseModel):
    method: str
    clusters: int
    silhouette: float | None
    gap_threshold: float
    topics: list[Topic]
    points: list[TopicPoint]
    reason: str | None = None


class AnalyticsReport(BaseModel):
    overview: Overview
    topics: TopicsReport
    confidence: ConfidenceReport
