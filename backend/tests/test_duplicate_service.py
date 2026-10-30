"""
Unit tests for DuplicateService (backend/services/duplicate_service.py).
"""

import sys
import os

# Ensure the backend directory is on the path before importing other modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import json
import pytest
from unittest.mock import MagicMock, patch
import threading
import time

from services.duplicate_service import DuplicateService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clean_env():
    """Ensure clean environment for each test."""
    env_vars = [
        "SENTENCE_TRANSFORMER_MODEL_PATH",
        "ALLOW_DEGRADED_STARTUP",
        "DUPLICATE_CACHE_MAX",
    ]
    for var in env_vars:
        os.environ.pop(var, None)
    yield
    for var in env_vars:
        os.environ.pop(var, None)


@pytest.fixture
def mock_sentence_transformers():
    """Mock the sentence_transformers module."""
    mock_st = MagicMock()
    mock_model = MagicMock()
    mock_st.SentenceTransformer.return_value = mock_model
    return mock_st, mock_model


# ---------------------------------------------------------------------------
# load() — model loading
# ---------------------------------------------------------------------------

class TestDuplicateServiceLoad:
    """Tests for DuplicateService.load()."""

    @patch("services.duplicate_service._HAS_SENTENCE", True)
    @patch("services.duplicate_service.SentenceTransformer")
    def test_loads_from_local_path_when_set(self, mock_ST):
        os.environ["SENTENCE_TRANSFORMER_MODEL_PATH"] = "/tmp/my-model"
        with patch("os.path.exists", return_value=True):
            svc = DuplicateService()
            svc.load()
            mock_ST.assert_called_with("/tmp/my-model")
            assert svc._loaded is True

    @patch("services.duplicate_service._HAS_SENTENCE", True)
    @patch("services.duplicate_service.SentenceTransformer")
    def test_loads_from_huggingface_when_no_local_path(self, mock_ST):
        svc = DuplicateService()
        svc.load()
        mock_ST.assert_called_with("all-MiniLM-L6-v2")
        assert svc._loaded is True

    @patch("services.duplicate_service._HAS_SENTENCE", True)
    @patch("services.duplicate_service.SentenceTransformer")
    def test_load_is_idempotent(self, mock_ST):
        svc = DuplicateService()
        svc.load()
        svc.load()  # Second call should be a no-op
        assert mock_ST.call_count == 1

    @patch("services.duplicate_service._HAS_SENTENCE", True)
    @patch("services.duplicate_service.SentenceTransformer")
    def test_load_reads_storage_file(self, mock_ST, tmp_path):
        storage_file = tmp_path / "case_history_cache.json"
        storage_file.write_text(json.dumps([
            {"ticket_id": "t1", "text": "hello world"},
            {"ticket_id": "t2", "text": "foo bar"},
        ]))

        svc = DuplicateService()
        svc.storage_file = str(storage_file)
        svc.load()

        assert svc._loaded is True
        assert len(svc._tickets) == 2


# ---------------------------------------------------------------------------
# load() — degraded startup
# ---------------------------------------------------------------------------

class TestDuplicateServiceDegraded:
    """Tests for ALLOW_DEGRADED_STARTUP handling."""

    @patch("services.duplicate_service._HAS_SENTENCE", False)
    def test_degraded_mode_when_no_sentence_transformers(self):
        os.environ["ALLOW_DEGRADED_STARTUP"] = "1"
        svc = DuplicateService()
        svc.load()
        assert svc._loaded is False
        assert svc.model is None

    @patch("services.duplicate_service._HAS_SENTENCE", False)
    def test_raises_when_no_sentence_transformers_and_no_degraded(self):
        svc = DuplicateService()
        with pytest.raises(ImportError, match="sentence-transformers"):
            svc.load()


# ---------------------------------------------------------------------------
# is_available()
# ---------------------------------------------------------------------------

class TestDuplicateServiceIsAvailable:
    """Tests for is_available()."""

    @patch("services.duplicate_service._HAS_SENTENCE", True)
    @patch("services.duplicate_service.SentenceTransformer")
    def test_available_after_successful_load(self, mock_ST):
        svc = DuplicateService()
        svc.load()
        assert svc.is_available() is True

    @patch("services.duplicate_service._HAS_SENTENCE", False)
    def test_not_available_when_load_failed(self):
        os.environ["ALLOW_DEGRADED_STARTUP"] = "1"
        svc = DuplicateService()
        svc.load()
        assert svc.is_available() is False


# ---------------------------------------------------------------------------
# save_to_disk & add_ticket thread safety & empty files
# ---------------------------------------------------------------------------

class TestDuplicateServiceThreadSafety:
    """Tests for DuplicateService thread-safety and empty file handling."""

    @patch("services.duplicate_service._HAS_SENTENCE", True)
    @patch("services.duplicate_service.SentenceTransformer")
    def test_empty_json_file_does_not_crash(self, mock_ST, tmp_path):
        # Create empty cache file
        storage_file = tmp_path / "case_history_cache.json"
        storage_file.write_text("")

        svc = DuplicateService()
        svc.storage_file = str(storage_file)
        
        # load() should not crash on empty file
        svc.load()
        assert len(svc._tickets) == 0

    @patch("services.duplicate_service._HAS_SENTENCE", True)
    @patch("services.duplicate_service.SentenceTransformer")
    def test_corrupt_json_file_handles_gracefully(self, mock_ST, tmp_path):
        # Create corrupt cache file
        storage_file = tmp_path / "case_history_cache.json"
        storage_file.write_text("invalid json content")

        svc = DuplicateService()
        svc.storage_file = str(storage_file)
        
        # load() should handle it gracefully and log error without crash
        svc.load()
        assert len(svc._tickets) == 0

    @patch("services.duplicate_service._HAS_SENTENCE", True)
    @patch("services.duplicate_service.SentenceTransformer")
    def test_save_to_disk_acquires_lock(self, mock_ST, tmp_path):
        storage_file = tmp_path / "case_history_cache.json"
        svc = DuplicateService()
        svc.storage_file = str(storage_file)

        # Acquire lock in main thread
        svc._lock.acquire()
        
        blocker_ran = False
        def blocker():
            nonlocal blocker_ran
            svc.save_to_disk("t1", "hello")
            blocker_ran = True

        t = threading.Thread(target=blocker)
        t.start()
        
        # Give it a tiny bit of time
        time.sleep(0.1)
        assert blocker_ran is False  # Must be blocked since lock is held by us
        
        svc._lock.release()
        t.join()
        assert blocker_ran is True  # Now it should finish

    @patch("services.duplicate_service._HAS_SENTENCE", True)
    @patch("services.duplicate_service.SentenceTransformer")
    def test_concurrent_adds_and_checks(self, mock_ST, tmp_path):
        storage_file = tmp_path / "case_history_cache.json"
        svc = DuplicateService()
        svc.storage_file = str(storage_file)
        
        mock_model = MagicMock()
        mock_model.encode.return_value = MagicMock()
        svc.model = mock_model
        svc._loaded = True

        # Run multiple threads adding tickets concurrently
        threads = []
        for i in range(10):
            t = threading.Thread(target=svc.add_ticket, args=(f"t-{i}", f"text-{i}"))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        # Check total tickets added
        assert len(svc._tickets) == 10


# ---------------------------------------------------------------------------
# check_duplicate() — empty & whitespace handling (#4080)
# ---------------------------------------------------------------------------

class TestDuplicateServiceEmptyWhitespace:
    """Tests for empty and whitespace-only text in check_duplicate (#4080)."""

    def test_empty_string_returns_early(self):
        svc = DuplicateService()
        svc.model = None
        svc._loaded = False
        res = svc.check_duplicate("")
        assert res == {
            "is_duplicate": False,
            "duplicate_ticket_id": None,
            "similarity": 0.0,
        }
        # Model must not have been loaded
        assert svc._loaded is False

    def test_whitespace_string_returns_early(self):
        svc = DuplicateService()
        svc.model = None
        svc._loaded = False
        res = svc.check_duplicate("    \n\t  ")
        assert res == {
            "is_duplicate": False,
            "duplicate_ticket_id": None,
            "similarity": 0.0,
        }
        # Model must not have been loaded
        assert svc._loaded is False

    def test_none_input_returns_early(self):
        svc = DuplicateService()
        svc.model = None
        svc._loaded = False
        res = svc.check_duplicate(None)
        assert res == {
            "is_duplicate": False,
            "duplicate_ticket_id": None,
            "similarity": 0.0,
        }
        assert svc._loaded is False
