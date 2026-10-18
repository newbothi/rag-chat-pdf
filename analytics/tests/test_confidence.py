from app.confidence import MIN_SAMPLES, ConfidenceModel, heuristic_probability, level_for
from app.schemas import QueryFeatures


def features(top: float, above: int = 3) -> QueryFeatures:
    return QueryFeatures(
        top_similarity=top,
        avg_similarity=top - 0.1,
        similarity_spread=0.15,
        chunks_above_threshold=above,
        distinct_pages=2,
        question_words=8,
        is_follow_up=False,
        has_document_filter=False,
    )


def test_cold_start_uses_heuristic_and_explains_why(labeled_samples):
    model = ConfidenceModel(relevance_threshold=0.5)
    report = model.train(labeled_samples[:5])

    assert report.model == "heuristic"
    assert report.reason and str(MIN_SAMPLES) in report.reason
    assert model.predict(features(0.75)).model == "heuristic"


def test_heuristic_is_monotonic_and_penalizes_no_relevant_chunks():
    low, high = heuristic_probability(features(0.35), 0.5), heuristic_probability(features(0.75), 0.5)
    assert low < 0.2 < 0.9 < high
    assert heuristic_probability(features(0.6, above=0), 0.5) < heuristic_probability(features(0.6, above=2), 0.5)


def test_logistic_recovers_known_pattern(labeled_samples):
    model = ConfidenceModel(relevance_threshold=0.5)
    report = model.train(labeled_samples)

    assert report.model == "logistic"
    assert report.cv_auc is not None and report.cv_auc > 0.8
    assert report.baseline_auc is not None
    # El patrón plantado depende de la similitud: es la feature con más peso y su efecto es positivo
    top = report.coefficients[0]
    assert top.feature in {"top_similarity", "avg_similarity"} and top.value > 0
    cm = report.confusion
    assert cm and cm.true_positive + cm.false_positive + cm.true_negative + cm.false_negative == len(labeled_samples)

    assert model.predict(features(0.78)).probability > 0.7
    assert model.predict(features(0.32)).probability < 0.3


def test_model_persists_and_reloads(labeled_samples, tmp_path):
    path = tmp_path / "confidence.joblib"
    ConfidenceModel(0.5, path).train(labeled_samples)

    reloaded = ConfidenceModel(0.5, path)
    assert reloaded.load()
    assert reloaded.report.model == "logistic"
    assert reloaded.predict(features(0.78)).model == "logistic"


def test_levels():
    assert level_for(0.85) == "alta"
    assert level_for(0.5) == "media"
    assert level_for(0.1) == "baja"
