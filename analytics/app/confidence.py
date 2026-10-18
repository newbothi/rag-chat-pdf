"""Modelo de confianza: estima la probabilidad de que una respuesta reciba
feedback positivo a partir de las métricas de recuperación, ANTES de generarla.

- Regresión logística (features estandarizadas, clases balanceadas).
- Evaluación con validación cruzada estratificada: AUC, accuracy, Brier y
  matriz de confusión, comparada con un baseline que usa solo la similitud
  del mejor fragmento.
- Arranque en frío: con pocas etiquetas se usa una heurística sobre la
  similitud y se informa el motivo.
"""

from __future__ import annotations

import logging
import math
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, confusion_matrix, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import StandardScaler

from .repository import LabeledSample
from .schemas import (
    FEATURE_LABELS,
    FEATURE_NAMES,
    Coefficient,
    ConfidenceLevel,
    ConfidencePrediction,
    ConfidenceReport,
    ConfusionMatrix,
    QueryFeatures,
)

log = logging.getLogger(__name__)

MIN_SAMPLES = 20
MIN_PER_CLASS = 5
TOP_SIMILARITY_INDEX = FEATURE_NAMES.index("top_similarity")


def level_for(probability: float) -> ConfidenceLevel:
    if probability >= 0.7:
        return "alta"
    if probability >= 0.4:
        return "media"
    return "baja"


def heuristic_probability(features: QueryFeatures, relevance_threshold: float) -> float:
    """Curva logística centrada en el umbral de relevancia. Si ningún fragmento
    lo supera, la confianza se reduce a la mitad."""
    p = 1.0 / (1.0 + math.exp(-14.0 * (features.top_similarity - (relevance_threshold + 0.05))))
    if features.chunks_above_threshold == 0:
        p *= 0.5
    return float(min(max(p, 0.0), 1.0))


def _new_pipeline() -> Pipeline:
    return make_pipeline(
        StandardScaler(),
        LogisticRegression(class_weight="balanced", max_iter=1000),
    )


@dataclass
class _State:
    pipeline: Pipeline | None
    report: ConfidenceReport


class ConfidenceModel:
    def __init__(self, relevance_threshold: float, model_path: Path | None = None):
        self.relevance_threshold = relevance_threshold
        self.model_path = model_path
        self._lock = threading.Lock()
        self._state = _State(pipeline=None, report=self._empty_report("Aún no se ha entrenado."))

    # ---------- entrenamiento ----------

    def train(self, samples: list[LabeledSample]) -> ConfidenceReport:
        state = self._fit(samples)
        with self._lock:
            self._state = state
        self._save(state)
        return state.report

    def _fit(self, samples: list[LabeledSample]) -> _State:
        X = np.asarray([s.features for s in samples], dtype=float).reshape(-1, len(FEATURE_NAMES))
        y = np.asarray([1 if s.positive else 0 for s in samples], dtype=int)
        n_pos, n_neg = int(y.sum()), int(len(y) - y.sum())
        counts = dict(
            labeled_samples=len(y),
            positive_samples=n_pos,
            negative_samples=n_neg,
            synthetic_samples=sum(s.synthetic for s in samples),
        )

        if len(y) < MIN_SAMPLES or min(n_pos, n_neg) < MIN_PER_CLASS:
            reason = (
                f"Se necesitan al menos {MIN_SAMPLES} respuestas con feedback y {MIN_PER_CLASS} de cada tipo "
                f"(hay {len(y)}: {n_pos} positivas y {n_neg} negativas). Mientras tanto se usa una heurística "
                "basada en la similitud del mejor fragmento."
            )
            return _State(pipeline=None, report=self._empty_report(reason, **counts))

        folds = min(5, n_pos, n_neg)
        cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)

        proba = cross_val_predict(_new_pipeline(), X, y, cv=cv, method="predict_proba")[:, 1]
        baseline = cross_val_predict(_new_pipeline(), X[:, [TOP_SIMILARITY_INDEX]], y, cv=cv, method="predict_proba")[
            :, 1
        ]
        predicted = (proba >= 0.5).astype(int)
        tn, fp, fn, tp = confusion_matrix(y, predicted, labels=[0, 1]).ravel()

        pipeline = _new_pipeline().fit(X, y)
        coefs = pipeline.named_steps["logisticregression"].coef_[0]

        report = ConfidenceReport(
            model="logistic",
            trained_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            min_samples_required=MIN_SAMPLES,
            cv_folds=folds,
            cv_auc=round(float(roc_auc_score(y, proba)), 4),
            baseline_auc=round(float(roc_auc_score(y, baseline)), 4),
            cv_accuracy=round(float(accuracy_score(y, predicted)), 4),
            cv_brier=round(float(brier_score_loss(y, proba)), 4),
            confusion=ConfusionMatrix(
                true_positive=int(tp), false_positive=int(fp), true_negative=int(tn), false_negative=int(fn)
            ),
            coefficients=sorted(
                (
                    Coefficient(feature=name, label=FEATURE_LABELS[name], value=round(float(c), 4))
                    for name, c in zip(FEATURE_NAMES, coefs, strict=True)
                ),
                key=lambda c: abs(c.value),
                reverse=True,
            ),
            **counts,
        )
        return _State(pipeline=pipeline, report=report)

    def _empty_report(self, reason: str, **counts: int) -> ConfidenceReport:
        return ConfidenceReport(
            model="heuristic",
            trained_at=None,
            labeled_samples=counts.get("labeled_samples", 0),
            positive_samples=counts.get("positive_samples", 0),
            negative_samples=counts.get("negative_samples", 0),
            synthetic_samples=counts.get("synthetic_samples", 0),
            min_samples_required=MIN_SAMPLES,
            reason=reason,
        )

    # ---------- predicción ----------

    def predict(self, features: QueryFeatures) -> ConfidencePrediction:
        with self._lock:
            pipeline = self._state.pipeline
        if pipeline is None:
            p = heuristic_probability(features, self.relevance_threshold)
            return ConfidencePrediction(probability=round(p, 4), level=level_for(p), model="heuristic")
        p = float(pipeline.predict_proba(np.asarray([features.as_row()]))[0, 1])
        return ConfidencePrediction(probability=round(p, 4), level=level_for(p), model="logistic")

    @property
    def report(self) -> ConfidenceReport:
        with self._lock:
            return self._state.report

    # ---------- persistencia ----------

    def _save(self, state: _State) -> None:
        if not self.model_path or state.pipeline is None:
            return
        try:
            self.model_path.parent.mkdir(parents=True, exist_ok=True)
            joblib.dump({"pipeline": state.pipeline, "report": state.report.model_dump()}, self.model_path)
        except OSError as err:  # no es crítico: se puede reentrenar
            log.warning("No se pudo guardar el modelo: %s", err)

    def load(self) -> bool:
        if not self.model_path or not self.model_path.exists():
            return False
        try:
            data = joblib.load(self.model_path)
            state = _State(pipeline=data["pipeline"], report=ConfidenceReport(**data["report"]))
        except Exception as err:  # archivo corrupto o de otra versión de sklearn
            log.warning("No se pudo cargar el modelo guardado: %s", err)
            return False
        with self._lock:
            self._state = state
        return True
