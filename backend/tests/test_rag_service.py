import pytest
from backend.services.rag_service import VectorRAGService


def test_rag_service_returns_recommendations_for_valid_query():
    service = VectorRAGService(min_confidence_threshold=0.6)
    recommendations = service.get_kb_recommendations_for_ticket("User needs to reset password and MFA")

    assert len(recommendations) > 0
    top_result = recommendations[0]
    assert "article_id" in top_result
    assert "confidence_score" in top_result
    assert top_result["confidence_score"] >= 0.6


def test_rag_service_returns_empty_list_for_blank_query():
    service = VectorRAGService()
    assert service.get_kb_recommendations_for_ticket("") == []
    assert service.get_kb_recommendations_for_ticket("   ") == []


def test_rag_service_filters_below_confidence_threshold():
    service = VectorRAGService(min_confidence_threshold=0.99)
    recommendations = service.get_kb_recommendations_for_ticket("random ticket text")
    assert len(recommendations) == 0
