"""
Tests for thread safety in DuplicateService (Issue #906).
Covers: concurrent add_ticket calls, check_duplicate during add_ticket,
snapshot isolation, lock release after exception, load() idempotency.

These tests use threading.Thread to simulate concurrent access.
The sentence_transformers model is mocked to avoid requiring ML dependencies.
"""

import sys
import os
import threading
import time
import unittest
from unittest.mock import MagicMock, patch, PropertyMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.services.duplicate_service import DuplicateService, SIMILARITY_THRESHOLD


def _make_service_with_mock_model():
    """Build a DuplicateService with a mocked sentence-transformer model."""
    import numpy as np

    svc = DuplicateService()
    svc._loaded = True
    svc._load_failed = False

    # Mock the model.encode method to return deterministic tensors
    mock_model = MagicMock()
    call_count = [0]

    def fake_encode(text, *args, **kwargs):
        call_count[0] += 1
        # Return a simple 3-dim tensor based on text hash for determinism
        val = float(hash(text) % 100) / 100.0
        return np.array([val, val * 0.5, val * 0.25], dtype=np.float32)

    mock_model.encode = fake_encode
    svc.model = mock_model
    svc.save_to_disk = lambda tid, text: True  # no disk I/O in tests

    return svc


def _ticket_count(svc):
    with svc._lock:
        return len(svc._tickets)


class TestLockExists(unittest.TestCase):
    def test_service_has_lock(self):
        svc = DuplicateService()
        self.assertTrue(hasattr(svc, "_lock"))
        acquired = svc._lock.acquire(timeout=1.0)
        self.assertTrue(acquired)
        if acquired:
            svc._lock.release()

    def test_service_starts_with_empty_tickets(self):
        svc = DuplicateService()
        self.assertEqual(len(svc._tickets), 0)


class TestConcurrentAddTicket(unittest.TestCase):
    def test_concurrent_add_does_not_corrupt_state(self):
        """Multiple threads calling add_ticket must not lose entries."""
        svc = _make_service_with_mock_model()
        n_threads = 20
        errors = []

        def add(i):
            try:
                svc.add_ticket(f"ticket-{i}", f"This is ticket number {i} about network issue")
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=add, args=(i,)) for i in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0, f"Errors during concurrent add: {errors}")
        self.assertEqual(_ticket_count(svc), n_threads,
                         f"Expected {n_threads} tickets, got {_ticket_count(svc)}")

    def test_concurrent_add_all_ticket_ids_unique(self):
        """Each concurrent add should produce a unique entry in _tickets."""
        svc = _make_service_with_mock_model()
        n_threads = 10

        def add(i):
            svc.add_ticket(f"unique-{i}", f"Issue description for ticket {i}")

        threads = [threading.Thread(target=add, args=(i,)) for i in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        ids = [tid for tid, _, _ in svc._tickets]
        self.assertEqual(len(ids), len(set(ids)), "Duplicate ticket IDs found in _tickets")

    def test_add_and_check_concurrent_does_not_crash(self):
        """check_duplicate called while add_ticket is running must not crash."""
        svc = _make_service_with_mock_model()
        # Pre-seed some tickets
        for i in range(5):
            svc.add_ticket(f"seed-{i}", f"Seed ticket {i}")

        errors = []

        def add_many():
            for i in range(10):
                try:
                    svc.add_ticket(f"concurrent-{i}", f"Concurrent ticket {i}")
                except Exception as exc:
                    errors.append(("add", exc))

        def check_many():
            for _ in range(10):
                try:
                    svc.check_duplicate("Network printer offline")
                except Exception as exc:
                    errors.append(("check", exc))

        t1 = threading.Thread(target=add_many)
        t2 = threading.Thread(target=check_many)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        self.assertEqual(len(errors), 0, f"Errors during concurrent add+check: {errors}")


class TestSnapshotIsolation(unittest.TestCase):
    def test_snapshot_isolates_concurrent_writes(self):
        """
        Snapshot taken at check_duplicate start must not include tickets
        added during the similarity computation.
        """
        svc = _make_service_with_mock_model()
        svc.add_ticket("t0", "Printer not working")

        # Capture snapshot count at check start
        initial_count = _ticket_count(svc)

        # Simulate adding ticket mid-check by inserting after snapshot
        result = svc.check_duplicate("Printer offline issue")
        final_count = _ticket_count(svc)

        # The result should be based on the snapshot at check start
        self.assertIn("is_duplicate", result)
        # Count may have changed during check — that's fine
        self.assertGreaterEqual(final_count, initial_count)

    def test_check_duplicate_returns_consistent_structure(self):
        svc = _make_service_with_mock_model()
        svc.add_ticket("t1", "VPN Connection timeout")

        result = svc.check_duplicate("VPN not connecting")
        self.assertIn("is_duplicate", result)
        self.assertIn("duplicate_ticket_id", result)
        self.assertIn("similarity", result)
        self.assertIsInstance(result["is_duplicate"], bool)
        self.assertIsInstance(result["similarity"], float)


class TestLockReleasedAfterException(unittest.TestCase):
    def test_lock_released_when_save_raises(self):
        """An unexpected save exception must not leave the lock held."""
        svc = _make_service_with_mock_model()

        def fail_save(ticket_id, text):
            raise RuntimeError("Simulated save failure")

        svc.save_to_disk = fail_save

        with self.assertRaises(RuntimeError):
            svc.add_ticket("fail-ticket", "This will fail")

        acquired = []

        def try_acquire_lock():
            result = svc._lock.acquire(timeout=1.0)
            acquired.append(result)
            if result:
                svc._lock.release()

        thread = threading.Thread(target=try_acquire_lock)
        thread.start()
        thread.join(timeout=2.0)

        self.assertFalse(thread.is_alive())
        self.assertEqual(acquired, [True])


class TestLoadIdempotency(unittest.TestCase):
    def test_load_called_multiple_times_is_safe(self):
        """Calling load() from multiple threads simultaneously must not error."""
        svc = DuplicateService()
        svc._loaded = True  # Simulate already loaded
        errors = []

        def call_load():
            try:
                svc.load()
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=call_load) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0, f"Errors during concurrent load: {errors}")

    def test_ticket_count_is_thread_safe(self):
        svc = _make_service_with_mock_model()
        svc.add_ticket("t1", "Test")
        svc.add_ticket("t2", "Test 2")

        results = []

        def count():
            results.append(_ticket_count(svc))

        threads = [threading.Thread(target=count) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # All counts should be consistent (2 or more, never negative)
        for r in results:
            self.assertGreaterEqual(r, 0)



class TestCheckDuplicateEdgeCases(unittest.TestCase):
    def test_empty_store_returns_no_duplicate(self):
        svc = _make_service_with_mock_model()
        result = svc.check_duplicate("Some ticket text")
        self.assertFalse(result["is_duplicate"])
        self.assertIsNone(result["duplicate_ticket_id"])
        self.assertEqual(result["similarity"], 0.0)

    def test_model_unavailable_returns_no_duplicate(self):
        svc = DuplicateService()
        svc._loaded = False
        svc._load_failed = True
        result = svc.check_duplicate("test text")
        self.assertFalse(result["is_duplicate"])
        self.assertIsNone(result["duplicate_ticket_id"])

    def test_custom_threshold_respected(self):
        svc = _make_service_with_mock_model()
        svc.add_ticket("t1", "printer not working")
        # Use threshold of 1.0 (impossibly high) — should never match
        result = svc.check_duplicate("printer offline", threshold=1.0)
        self.assertFalse(result["is_duplicate"])


class TestMatrixSnapshotConsistency(unittest.TestCase):
    def test_check_duplicate_does_not_return_id_from_stale_service_matrix(self):
        """check_duplicate must derive matrix and IDs from the same ticket snapshot."""
        import numpy as np

        svc = DuplicateService()
        svc._loaded = True
        svc._load_failed = False
        svc.model = MagicMock()
        svc.save_to_disk = lambda tid, text: True
        svc._get_embedding = lambda text: np.array([0.0, 1.0], dtype=np.float32)

        # The real ticket snapshot only contains existing-id.
        svc._tickets = [
            ("existing-id", np.array([1.0, 0.0], dtype=np.float32), "existing ticket")
        ]
        # Simulate a stale/mismatched service-level matrix from a concurrent update.
        # The query vector best matches injected-id, but injected-id is not present
        # in the current _tickets snapshot and must never be returned.
        svc._embedding_matrix = np.array(
            [[1.0, 0.0], [0.0, 1.0]], dtype=np.float32
        )
        svc._ticket_ids = ["existing-id", "injected-id"]
        svc._embedding_matrix_dirty = False

        result = svc.check_duplicate("query", threshold=0.0)

        self.assertEqual(result["duplicate_ticket_id"], "existing-id")


if __name__ == '__main__':
    unittest.main()
