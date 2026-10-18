"""Temas sin cobertura: agrupa las preguntas de los usuarios por significado
(clustering de sus embeddings) y mide, por grupo, qué tan bien lo cubren los
documentos (similitud del mejor fragmento) y cómo lo evalúan los usuarios.

- Embeddings normalizados → KMeans equivale a agrupar por similitud coseno.
- k se elige automáticamente maximizando el coeficiente de silueta.
- Etiquetas: la pregunta más cercana al centroide + palabras clave por c-TF-IDF
  (TF-IDF del grupo frente al resto de las preguntas).
- Proyección 2D con PCA para visualizar los grupos.
"""

from __future__ import annotations

import re
import unicodedata

import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.metrics import silhouette_score

from .repository import QueryRecord
from .schemas import Overview, Topic, TopicExample, TopicPoint, TopicsReport

MIN_QUERIES = 6
MAX_CLUSTERS = 12

SPANISH_STOPWORDS = sorted(
    set(
        [
            "a",
            "al",
            "algo",
            "algun",
            "alguna",
            "algunas",
            "alguno",
            "algunos",
            "ante",
            "antes",
            "asi",
            "aun",
            "bajo",
            "bien",
            "cada",
            "como",
            "con",
            "contra",
            "cual",
            "cuales",
            "cuando",
            "cuanto",
            "cuanta",
            "cuantos",
            "cuantas",
            "de",
            "del",
            "desde",
            "donde",
            "dos",
            "el",
            "ella",
            "ellas",
            "ellos",
            "en",
            "entre",
            "era",
            "es",
            "esa",
            "esas",
            "ese",
            "eso",
            "esos",
            "esta",
            "estan",
            "estar",
            "estas",
            "este",
            "esto",
            "estos",
            "fue",
            "fueron",
            "ha",
            "hay",
            "hace",
            "hacer",
            "hasta",
            "la",
            "las",
            "le",
            "les",
            "lo",
            "los",
            "mas",
            "me",
            "mi",
            "mis",
            "mucho",
            "muy",
            "nada",
            "ni",
            "no",
            "nos",
            "nosotros",
            "o",
            "otra",
            "otro",
            "para",
            "pero",
            "poco",
            "por",
            "porque",
            "puede",
            "pueden",
            "puedo",
            "que",
            "quien",
            "se",
            "sea",
            "ser",
            "si",
            "sin",
            "sobre",
            "solo",
            "son",
            "su",
            "sus",
            "tambien",
            "tan",
            "tanto",
            "te",
            "tener",
            "tengo",
            "tiene",
            "tienen",
            "todo",
            "todos",
            "tu",
            "tus",
            "un",
            "una",
            "uno",
            "unos",
            "y",
            "ya",
            "yo",
            "debo",
            "debe",
            "necesito",
            "quiero",
            "saber",
            "cual",
            "cuales",
            "hago",
            "hacen",
            "pasa",
            "dan",
            "da",
            "dice",
            "dicen",
            "existe",
            "hay",
            "tengo",
            "tenemos",
            "sabe",
            "alguien",
            "favor",
            "empresa",
            "nimbus",
        ]
    )
)


def _strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def _normalize_text(text: str) -> str:
    return re.sub(r"[^a-z0-9ñ ]+", " ", _strip_accents(text.lower()))


def build_overview(records: list[QueryRecord], gap_threshold: float) -> Overview:
    with_feedback = [r for r in records if r.feedback is not None]
    latencies = [r.latency_ms for r in records if r.latency_ms is not None]
    sims = [r.top_similarity for r in records]
    return Overview(
        total_queries=len(records),
        synthetic_queries=sum(r.synthetic for r in records),
        with_feedback=len(with_feedback),
        positive_rate=round(sum(r.feedback == 1 for r in with_feedback) / len(with_feedback), 4)
        if with_feedback
        else None,
        avg_top_similarity=round(float(np.mean(sims)), 4) if sims else None,
        avg_latency_ms=round(float(np.mean(latencies)), 1) if latencies else None,
        low_coverage_rate=round(sum(s < gap_threshold for s in sims) / len(sims), 4) if sims else None,
    )


def _choose_k(X: np.ndarray) -> tuple[np.ndarray, int, float | None]:
    n = len(X)
    max_k = min(MAX_CLUSTERS, n // 3)
    if max_k < 2:
        return np.zeros(n, dtype=int), 1, None

    best: tuple[float, int, np.ndarray] | None = None
    for k in range(2, max_k + 1):
        labels = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(X)
        if len(set(labels)) < 2:
            continue
        score = float(silhouette_score(X, labels))
        if best is None or score > best[0]:
            best = (score, k, labels)
    if best is None:
        return np.zeros(n, dtype=int), 1, None
    score, k, labels = best
    return labels, k, round(score, 4)


def _keywords(questions: list[str], labels: np.ndarray, top_n: int = 5) -> dict[int, list[str]]:
    docs = [_normalize_text(q) for q in questions]
    stop = [_strip_accents(w) for w in SPANISH_STOPWORDS]
    try:
        vectorizer = CountVectorizer(stop_words=stop, token_pattern=r"(?u)\b[a-zñ]{3,}\b")  # noqa: S106 (no es una contraseña)
        counts = vectorizer.fit_transform(docs)
    except ValueError:  # vocabulario vacío
        return {int(c): [] for c in set(labels)}
    vocab = np.asarray(vectorizer.get_feature_names_out())

    clusters = sorted(set(int(c) for c in labels))
    # c-TF-IDF: frecuencia del término en el grupo × log(1 + promedio de palabras por grupo / frecuencia global)
    tf = np.vstack([np.asarray(counts[labels == c].sum(axis=0)).ravel() for c in clusters]).astype(float)
    tf_norm = tf / np.maximum(tf.sum(axis=1, keepdims=True), 1)
    avg_words = tf.sum() / len(clusters)
    idf = np.log1p(avg_words / np.maximum(tf.sum(axis=0), 1))
    scores = tf_norm * idf

    result: dict[int, list[str]] = {}
    for i, c in enumerate(clusters):
        order = np.argsort(-scores[i])
        result[c] = [str(vocab[j]) for j in order[:top_n] if tf[i, j] > 0]
    return result


def build_topics(records: list[QueryRecord], gap_threshold: float) -> TopicsReport:
    if len(records) < MIN_QUERIES:
        return TopicsReport(
            method="kmeans-coseno",
            clusters=0,
            silhouette=None,
            gap_threshold=gap_threshold,
            topics=[],
            points=[],
            reason=f"Se necesitan al menos {MIN_QUERIES} preguntas para agrupar por tema (hay {len(records)}).",
        )

    X = np.vstack([r.embedding for r in records]).astype(float)
    X /= np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-12)

    labels, k, silhouette = _choose_k(X)
    questions = [r.question for r in records]
    keywords = _keywords(questions, labels)
    coords = PCA(n_components=2, random_state=42).fit_transform(X) if len(X) >= 2 else np.zeros((len(X), 2))

    topics: list[Topic] = []
    n = len(records)
    for c in sorted(set(int(c) for c in labels)):
        idx = np.where(labels == c)[0]
        members = [records[i] for i in idx]
        centroid = X[idx].mean(axis=0)
        centrality = X[idx] @ centroid
        order = idx[np.argsort(-centrality)]

        sims = np.asarray([m.top_similarity for m in members])
        rated = [m.feedback for m in members if m.feedback is not None]
        negative_rate = round(sum(f == -1 for f in rated) / len(rated), 4) if rated else None
        avg_sim = float(sims.mean())
        low_rate = float((sims < gap_threshold).mean())
        share = len(idx) / n

        if avg_sim < gap_threshold or (len(rated) >= 3 and (negative_rate or 0) >= 0.5):
            status = "sin_cobertura"
        elif low_rate >= 0.3 or (len(rated) >= 3 and (negative_rate or 0) >= 0.3):
            status = "parcial"
        else:
            status = "cubierto"

        topics.append(
            Topic(
                id=c,
                label=records[order[0]].question,
                keywords=keywords.get(c, []),
                size=len(idx),
                share=round(share, 4),
                avg_top_similarity=round(avg_sim, 4),
                low_coverage_rate=round(low_rate, 4),
                feedback_count=len(rated),
                negative_rate=negative_rate,
                status=status,
                # Prioriza temas frecuentes, mal cubiertos y mal evaluados
                gap_score=round(share * (1 - avg_sim) * (1 + (negative_rate or 0)), 4),
                examples=[
                    TopicExample(
                        question=records[i].question,
                        top_similarity=round(records[i].top_similarity, 4),
                        feedback=records[i].feedback,
                    )
                    for i in order[:5]
                ],
            )
        )

    topics.sort(key=lambda t: t.gap_score, reverse=True)
    points = [
        TopicPoint(
            x=round(float(coords[i, 0]), 4),
            y=round(float(coords[i, 1]), 4),
            topic=int(labels[i]),
            question=records[i].question,
            top_similarity=round(records[i].top_similarity, 4),
        )
        for i in range(n)
    ]
    return TopicsReport(
        method="kmeans-coseno",
        clusters=k,
        silhouette=silhouette,
        gap_threshold=gap_threshold,
        topics=topics,
        points=points,
    )
