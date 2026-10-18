from app.topics import MIN_QUERIES, build_overview, build_topics


def test_finds_planted_topics_and_flags_the_uncovered_one(topic_records):
    report = build_topics(topic_records, gap_threshold=0.5)

    assert report.clusters == 3
    assert report.silhouette is not None and report.silhouette > 0.1
    assert len(report.points) == len(topic_records)

    worst = report.topics[0]  # ordenados por gap_score
    assert worst.status == "sin_cobertura"
    assert "licencia" in " ".join(worst.keywords)
    assert worst.negative_rate == 1.0
    assert all(t.status == "cubierto" for t in report.topics[1:])
    assert abs(sum(t.share for t in report.topics) - 1) < 1e-3


def test_keywords_describe_each_topic(topic_records):
    report = build_topics(topic_records, gap_threshold=0.5)
    all_keywords = [" ".join(t.keywords) for t in report.topics]
    assert any("vacaciones" in k for k in all_keywords)
    assert any("reembolso" in k for k in all_keywords)


def test_not_enough_queries(topic_records):
    report = build_topics(topic_records[: MIN_QUERIES - 1], gap_threshold=0.5)
    assert report.clusters == 0 and report.reason


def test_overview(topic_records):
    ov = build_overview(topic_records, gap_threshold=0.5)
    assert ov.total_queries == len(topic_records)
    assert ov.with_feedback == sum(r.feedback is not None for r in topic_records)
    assert 0 < (ov.positive_rate or 0) < 1
    assert abs((ov.low_coverage_rate or 0) - 1 / 3) < 1e-3
