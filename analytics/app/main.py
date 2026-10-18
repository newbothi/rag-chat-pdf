"""Servicio de análisis (FastAPI). Lo consume Next.js por HTTP interno,
autenticado con un secreto compartido en la cabecera X-Analytics-Key."""

from __future__ import annotations

import logging
import secrets
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request

from .confidence import ConfidenceModel
from .config import settings
from .repository import Repository, SqlServerRepository
from .schemas import (
    AnalyticsReport,
    ConfidencePrediction,
    ConfidenceReport,
    QueryFeatures,
    TrainResponse,
)
from .topics import build_overview, build_topics

log = logging.getLogger("analytics")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def create_app(
    repository: Repository | None = None, model: ConfidenceModel | None = None, api_key: str | None = None
) -> FastAPI:
    repo: Repository = repository or SqlServerRepository()
    confidence = model or ConfidenceModel(settings.relevance_threshold, settings.model_path)
    key = settings.api_key if api_key is None else api_key

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # Al arrancar: carga el último modelo guardado y reentrena con los datos actuales.
        if confidence.load():
            log.info("Modelo de confianza cargado desde disco.")
        try:
            report = confidence.train(repo.labeled_samples())
            log.info("Modelo de confianza: %s (%d muestras)", report.model, report.labeled_samples)
        except Exception as err:
            log.warning("No se pudo entrenar al arrancar (¿SQL Server disponible?): %s", err)
        yield

    app = FastAPI(
        title="RAG Chat Analytics",
        version="1.0.0",
        description="Temas sin cobertura y confianza de respuestas para el chat con PDFs.",
        lifespan=lifespan,
    )

    def require_key(x_analytics_key: Annotated[str | None, Header()] = None) -> None:
        if not key:
            raise HTTPException(503, "ANALYTICS_API_KEY no está configurada en el servicio.")
        if not x_analytics_key or not secrets.compare_digest(x_analytics_key, key):
            raise HTTPException(401, "Clave de analytics inválida.")

    Auth = Depends(require_key)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "model": confidence.report.model}

    @app.post("/confidence/predict", response_model=ConfidencePrediction, dependencies=[Auth])
    def predict(features: QueryFeatures) -> ConfidencePrediction:
        return confidence.predict(features)

    @app.post("/confidence/train", response_model=TrainResponse, dependencies=[Auth])
    def train() -> TrainResponse:
        try:
            samples = repo.labeled_samples()
        except Exception as err:
            raise HTTPException(503, f"No se pudo leer la base de datos: {err}") from err
        return TrainResponse(report=confidence.train(samples))

    @app.get("/confidence/report", response_model=ConfidenceReport, dependencies=[Auth])
    def confidence_report() -> ConfidenceReport:
        return confidence.report

    @app.get("/report", response_model=AnalyticsReport, dependencies=[Auth])
    def report(include_synthetic: Annotated[bool, Query()] = True) -> AnalyticsReport:
        try:
            records = repo.queries(include_synthetic=include_synthetic)
        except Exception as err:
            raise HTTPException(503, f"No se pudo leer la base de datos: {err}") from err
        return AnalyticsReport(
            overview=build_overview(records, settings.gap_threshold),
            topics=build_topics(records, settings.gap_threshold),
            confidence=confidence.report,
        )

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):  # pragma: no cover - red de seguridad
        log.exception("Error no controlado: %s", exc)
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=500, content={"detail": "Error interno del servicio de análisis."})

    return app


app = create_app()
