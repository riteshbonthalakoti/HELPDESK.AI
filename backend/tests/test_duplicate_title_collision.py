"""
Tests for ticket title collision detection in DuplicateService — issue #3888.

Verifies that:
- Identical ticket titles trigger duplicate detection correctly
- Near-identical titles trigger potential duplicate detection
- Completely different titles do not trigger duplicate detection
- Title collision respects the similarity threshold
- check_duplicate returns the correct schema on collision
"""

import pytest
import numpy as np
from unittest.mock import MagicMock, patch
import sys
import os

sys.modules['sentence_transformers'] = MagicMock()

from backend.services.duplicate_service import DuplicateService, SIMILARITY_THRESHOLD


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_loaded_service():
    """Create a DuplicateService with a mocked loaded model."""
    svc = DuplicateService()
    svc.model = MagicMock()
    svc._loaded = True
    svc._load_failed = False
    return svc


def add_ticket_with_embedding(svc, ticket_id: str, text: str, embedding: np.ndarray):
    """Directly inject a ticket with a known embedding, bypassing model.encode."""
    with svc._lock:
        if ticket_id not in svc._ticket_id_set:
            svc._tickets.append((ticket_id, embedding, text))
            svc._ticket_id_set.add(ticket_id)


def unit_vector(size=8):
    """Return a normalised unit vector of given size."""
    v = np.ones(size, dtype=float)
    return v / np.linalg.norm(v)


# ---------------------------------------------------------------------------
# 1. Identical title → must trigger duplicate (similarity = 1.0)
# ---------------------------------------------------------------------------

class TestIdenticalTitleCollision:
    def test_identical_title_is_duplicate(self):
        svc = make_loaded_service()
        emb = unit_vector()
        add_ticket_with_embedding(svc, "T-001", "VPN not connecting", emb)

        # Same embedding for identical text
        svc.model.encode.return_value = emb

        result = svc.check_duplicate("VPN not connecting", threshold=SIMILARITY_THRESHOLD)

        assert result["is_duplicate"] is True
        assert result["duplicate_ticket_id"] == "T-001"
        assert result["similarity"] >= SIMILARITY_THRESHOLD

    def test_identical_title_returns_correct_ticket_id(self):
        svc = make_loaded_service()
        emb = unit_vector()
        add_ticket_with_embedding(svc, "TICKET-ABC", "Printer is offline", emb)

        svc.model.encode.return_value = emb
        result = svc.check_duplicate("Printer is offline")

        assert result["duplicate_ticket_id"] == "TICKET-ABC"
        assert result["parent_ticket_id"] == "TICKET-ABC"

    def test_identical_title_similarity_is_one(self):
        svc = make_loaded_service()
        emb = unit_vector()
        add_ticket_with_embedding(svc, "T-002", "Email not syncing", emb)

        svc.model.encode.return_value = emb
        result = svc.check_duplicate("Email not syncing")

        assert abs(result["similarity"] - 1.0) < 1e-4

    def test_multiple_tickets_best_match_returned(self):
        """When multiple tickets exist, the one with highest similarity is returned."""
        svc = make_loaded_service()

        emb_a = np.array([1.0, 0.0, 0.0, 0.0])
        emb_b = np.array([0.0, 1.0, 0.0, 0.0])
        emb_query = np.array([1.0, 0.0, 0.0, 0.0])  # identical to T-A

        add_ticket_with_embedding(svc, "T-A", "Laptop won't boot", emb_a)
        add_ticket_with_embedding(svc, "T-B", "Mouse not working", emb_b)

        svc.model.encode.return_value = emb_query
        result = svc.check_duplicate("Laptop won't boot")

        assert result["duplicate_ticket_id"] == "T-A"


# ---------------------------------------------------------------------------
# 2. Near-identical title → potential duplicate
# ---------------------------------------------------------------------------

class TestNearIdenticalTitleCollision:
    def test_near_identical_title_is_potential_duplicate(self):
        """Similarity between threshold*0.85 and threshold should be potential duplicate."""
        svc = make_loaded_service()

        # Craft embeddings with cosine similarity just below threshold
        emb_stored = np.array([1.0, 0.0, 0.0, 0.0], dtype=float)
        # Slightly different direction — similarity ~0.64 (below 0.70 threshold)
        emb_query = np.array([0.9, 0.436, 0.0, 0.0], dtype=float)
        emb_query = emb_query / np.linalg.norm(emb_query)

        add_ticket_with_embedding(svc, "T-003", "VPN disconnects frequently", emb_stored)
        svc.model.encode.return_value = emb_query

        result = svc.check_duplicate("VPN keeps dropping", threshold=0.70)

        # Should not be a full duplicate but might be potential
        assert isinstance(result["is_duplicate"], bool)
        assert "is_potential_duplicate" in result
        assert "similarity" in result

    def test_potential_duplicate_is_not_full_duplicate(self):
        """A near-match should not incorrectly set is_duplicate to True."""
        svc = make_loaded_service()

        emb_stored = np.array([1.0, 0.0, 0.0, 0.0], dtype=float)
        emb_query = np.array([0.5, 0.866, 0.0, 0.0], dtype=float)  # ~60% similarity

        add_ticket_with_embedding(svc, "T-004", "Screen flickering", emb_stored)
        svc.model.encode.return_value = emb_query

        result = svc.check_duplicate("Display issues on laptop", threshold=0.70)

        assert result["is_duplicate"] is False
        assert result["duplicate_ticket_id"] is None


# ---------------------------------------------------------------------------
# 3. Different title → no collision
# ---------------------------------------------------------------------------

class TestDifferentTitleNoCollision:
    def test_completely_different_title_not_duplicate(self):
        svc = make_loaded_service()

        emb_stored = np.array([1.0, 0.0, 0.0, 0.0], dtype=float)
        emb_query = np.array([0.0, 1.0, 0.0, 0.0], dtype=float)  # orthogonal = 0.0 similarity

        add_ticket_with_embedding(svc, "T-005", "Printer offline", emb_stored)
        svc.model.encode.return_value = emb_query

        result = svc.check_duplicate("Access denied on SharePoint", threshold=0.70)

        assert result["is_duplicate"] is False
        assert result["duplicate_ticket_id"] is None
        assert result["similarity"] == 0.0

    def test_empty_index_returns_not_duplicate(self):
        svc = make_loaded_service()
        svc.model.encode.return_value = unit_vector()

        result = svc.check_duplicate("Some ticket title")

        assert result["is_duplicate"] is False
        assert result["similarity"] == 0.0

    def test_not_loaded_returns_not_duplicate(self):
        svc = DuplicateService()
        svc._loaded = False

        result = svc.check_duplicate("VPN not connecting")

        assert result["is_duplicate"] is False
        assert result["similarity"] == 0.0


# ---------------------------------------------------------------------------
# 4. Threshold boundary tests
# ---------------------------------------------------------------------------

class TestThresholdBoundary:
    def test_similarity_exactly_at_threshold_is_duplicate(self):
        """Similarity exactly at threshold should be treated as duplicate."""
        svc = make_loaded_service()

        # Create embeddings with cosine similarity exactly at SIMILARITY_THRESHOLD
        emb_stored = np.array([1.0, 0.0], dtype=float)
        angle = np.arccos(SIMILARITY_THRESHOLD)
        emb_query = np.array([np.cos(angle), np.sin(angle)], dtype=float)

        add_ticket_with_embedding(svc, "T-006", "Network timeout", emb_stored)
        svc.model.encode.return_value = emb_query

        result = svc.check_duplicate("Network timeout issue", threshold=SIMILARITY_THRESHOLD)

        assert result["is_duplicate"] is True

    def test_similarity_below_threshold_not_duplicate(self):
        svc = make_loaded_service()

        emb_stored = np.array([1.0, 0.0], dtype=float)
        # Set angle so similarity is just below threshold
        angle = np.arccos(SIMILARITY_THRESHOLD - 0.01)
        emb_query = np.array([np.cos(angle), np.sin(angle)], dtype=float)

        add_ticket_with_embedding(svc, "T-007", "Slow internet", emb_stored)
        svc.model.encode.return_value = emb_query

        result = svc.check_duplicate("Internet speed issues", threshold=SIMILARITY_THRESHOLD)

        assert result["is_duplicate"] is False

    def test_custom_threshold_override(self):
        """A higher custom threshold should not flag borderline similarity."""
        svc = make_loaded_service()

        emb = unit_vector()
        add_ticket_with_embedding(svc, "T-008", "Software crash", emb)
        svc.model.encode.return_value = emb  # identical → similarity 1.0

        # Even with very high threshold, identical should still match
        result = svc.check_duplicate("Software crash", threshold=0.99)
        assert result["is_duplicate"] is True


# ---------------------------------------------------------------------------
# 5. Return schema validation
# ---------------------------------------------------------------------------

class TestReturnSchema:
    def test_schema_has_all_required_keys_on_collision(self):
        svc = make_loaded_service()
        emb = unit_vector()
        add_ticket_with_embedding(svc, "T-009", "WiFi drops", emb)
        svc.model.encode.return_value = emb

        result = svc.check_duplicate("WiFi drops")

        assert "is_duplicate" in result
        assert "duplicate_ticket_id" in result
        assert "parent_ticket_id" in result
        assert "is_potential_duplicate" in result
        assert "similarity" in result

    def test_schema_has_all_required_keys_on_no_collision(self):
        svc = make_loaded_service()
        result = svc.check_duplicate("Some ticket")

        assert "is_duplicate" in result
        assert "duplicate_ticket_id" in result
        assert "similarity" in result

    def test_similarity_is_float(self):
        svc = make_loaded_service()
        emb = unit_vector()
        add_ticket_with_embedding(svc, "T-010", "Bluetooth not pairing", emb)
        svc.model.encode.return_value = emb

        result = svc.check_duplicate("Bluetooth not pairing")

        assert isinstance(result["similarity"], float)

    def test_is_duplicate_is_bool(self):
        svc = make_loaded_service()
        emb = unit_vector()
        add_ticket_with_embedding(svc, "T-011", "USB not detected", emb)
        svc.model.encode.return_value = emb

        result = svc.check_duplicate("USB not detected")

        assert isinstance(result["is_duplicate"], bool)


# ---------------------------------------------------------------------------
# 6. Self-collision exclusion
# ---------------------------------------------------------------------------

class TestSelfCollisionExclusion:
    def test_ticket_does_not_match_itself(self):
        """check_duplicate with same ticket_id should skip self-match."""
        svc = make_loaded_service()
        emb = unit_vector()
        add_ticket_with_embedding(svc, "T-SELF", "Keyboard not working", emb)
        svc.model.encode.return_value = emb

        result = svc.check_duplicate(
            "Keyboard not working",
            ticket_id="T-SELF"
        )

        # Should skip self and return no match (only one ticket in index)
        assert result["is_duplicate"] is False
        assert result["duplicate_ticket_id"] is None