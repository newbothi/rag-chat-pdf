import pytest
from conftest import FakeRepository
from fastapi.testclient import TestClient

from app.confidence import ConfidenceModel
from app.main import create_app

KEY = "test-key"
HEADERS = {"X-Analytics-Key": KEY}
FEATURES = {
    "top_similarity": 0.72,
    "avg_similarity": 0.6,
    "similarity_spread": 0.2,
    "chunks_above_threshold": 4,
    "distinct_pages": 2,
    "question_words": 7,
    "is_follow_up": False,
    "has_document_filter": False,
}


@pytest.fixture
def client(labeled_samples, topic_records):
    app = create_app(FakeRepository(labeled_samples, topic_records), ConfidenceModel(0.5), api_key=KEY)
    with TestClient(app) as c:  # ejecuta el lifespan → entrena al arrancar
        yield c


def test_health_is_public(client):
    assert client.get("/health").json()["model"] == "logistic"


def test_requires_key(client):
    assert client.post("/confidence/predict", json=FEATURES).status_code == 401
    assert client.post("/confidence/predict", json=FEATURES, headers={"X-Analytics-Key": "otra"}).status_code == 401


def test_refuses_when_key_not_configured(labeled_samples):
    app = create_app(FakeRepository(labeled_samples), ConfidenceModel(0.5), api_key="")
    with TestClient(app) as c:
        assert c.get("/confidence/report", headers=HEADERS).status_code == 503


def test_predict(client):
    body = client.post("/confidence/predict", json=FEATURES, headers=HEADERS).json()
    assert body["model"] == "logistic"
    assert 0 <= body["probability"] <= 1
    assert body["level"] in {"alta", "media", "baja"}


def test_predict_validates_input(client):
    bad = {**FEATURES, "top_similarity": 5}
    assert client.post("/confidence/predict", json=bad, headers=HEADERS).status_code == 422


def test_report(client):
    body = client.get("/report", headers=HEADERS).json()
    assert body["overview"]["total_queries"] == 24
    assert body["topics"]["clusters"] == 3
    assert body["confidence"]["model"] == "logistic"


def test_report_without_synthetic(client):
    body = client.get("/report?include_synthetic=false", headers=HEADERS).json()
    assert body["overview"]["synthetic_queries"] == 0
    assert body["overview"]["total_queries"] < 24


def test_train(client):
    body = client.post("/confidence/train", headers=HEADERS).json()
    assert body["report"]["labeled_samples"] == 240
