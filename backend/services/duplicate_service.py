"""
Duplicate Detection Service.

Uses sentence-transformers to detect similar tickets.
Includes thread-safe storage, bounded caching, and atomic JSON writes.
"""

import json
import os
import threading

SIMILARITY_THRESHOLD = 0.70
MAX_CACHE_ENTRIES = int(os.getenv("DUPLICATE_CACHE_MAX", "1000"))

# Optional dependencies
try:
    import numpy as np
except ImportError:
    np = None

try:
    from sentence_transformers import SentenceTransformer, util
    _HAS_SENTENCE = True
except Exception:
    SentenceTransformer = None
    util = None
    _HAS_SENTENCE = False


class DuplicateService:
    def __init__(self):
        self.model = None
        self._loaded = False

        # Each entry: (ticket_id, embedding, text)
        self._tickets = []

        self._lock = threading.RLock()

        self.storage_file = os.path.join(
            os.path.dirname(__file__),
            "..",
            "data",
            "knowledge_base.json",
        )

        os.makedirs(os.path.dirname(self.storage_file), exist_ok=True)

    def is_available(self):
        """Return whether the embedding model loaded successfully."""
        return self._loaded and self.model is not None

    def load(self):
        """Load the embedding model and the most recent cached tickets."""
        with self._lock:
            if self._loaded:
                return

            if not _HAS_SENTENCE:

                if (
                    os.getenv("ALLOW_DEGRADED_STARTUP", "").lower()
                    in ("1", "true", "yes")
                    or os.path.isfile(self.storage_file)
                ):
                    print(
                        "[DuplicateService] Sentence-transformers unavailable; "
                        "starting in degraded mode."
                    )
                    return

                raise ImportError(
                    "sentence-transformers is required for duplicate detection."
                )

            print("[DuplicateService] Loading model...")

            model_path = os.getenv("SENTENCE_TRANSFORMER_MODEL_PATH")

            if model_path and os.path.exists(model_path):
                self.model = SentenceTransformer(model_path)
            else:
                self.model = SentenceTransformer("all-MiniLM-L6-v2")

            self._loaded = True

            if not os.path.exists(self.storage_file):
                return

            try:
                with open(self.storage_file, "r", encoding="utf-8") as file:
                    data = json.load(file)

                if not isinstance(data, list):
                    return

                # Re-encode only the most recent entries.
                data = data[-MAX_CACHE_ENTRIES:]

                loaded_tickets = []

                for item in data:
                    try:
                        ticket_id = item["ticket_id"]
                        text = item["text"]

                        embedding = self.model.encode(
                            text,
                            convert_to_tensor=True,
                        )

                        loaded_tickets.append(
                            (ticket_id, embedding, text)
                        )

                    except (KeyError, TypeError, ValueError) as exc:
                        print(
                            f"[DuplicateService] Skipping invalid entry: {exc}"
                        )

                self._tickets = loaded_tickets

                print(
                    f"[DuplicateService] Loaded "
                    f"{len(self._tickets)} tickets."
                )

            except (json.JSONDecodeError, OSError, TypeError) as exc:
                print(
                    f"[DuplicateService] Error loading storage: {exc}"
                )

    def save_to_disk(self, ticket_id: str, text: str):
        """Save a ticket using a bounded cache and atomic file replacement."""
        with self._lock:
            temp_file = self.storage_file + ".tmp"

            try:
                directory = os.path.dirname(self.storage_file)
                os.makedirs(directory, exist_ok=True)

                data = []

                if os.path.exists(self.storage_file):
                    try:
                        with open(
                            self.storage_file, "r", encoding="utf-8"
                        ) as file:
                            existing = json.load(file)

                        if isinstance(existing, list):
                            data = existing

                    except (json.JSONDecodeError, OSError):
                        data = []

                data.append({
                    "ticket_id": ticket_id,
                    "text": text,
                })

                # Retain only the newest entries.
                data = data[-MAX_CACHE_ENTRIES:]

                with open(temp_file, "w", encoding="utf-8") as file:
                    json.dump(data, file, indent=2)

                # Atomic replacement prevents partially written JSON.
                os.replace(temp_file, self.storage_file)

                print(
                    f"[DuplicateService] Saved ticket {ticket_id} "
                    "to knowledge base."
                )

            except Exception as exc:
                print(
                    f"[DuplicateService] Failed to save to disk: {exc}"
                )

                # Clean up an incomplete temporary file.
                try:
                    if os.path.exists(temp_file):
                        os.remove(temp_file)
                except OSError:
                    pass

    def add_ticket(self, ticket_id: str, text: str):
        """Add a ticket to memory and persist it to disk."""
        self.load()

        if not self.is_available():
            return

        embedding = self.model.encode(
            text,
            convert_to_tensor=True,
        )

        with self._lock:
            self._tickets.append((ticket_id, embedding, text))
            self._tickets = self._tickets[-MAX_CACHE_ENTRIES:]

        self.save_to_disk(ticket_id, text)

    def check_duplicate(
        self,
        text: str,
        threshold: float = None,
    ) -> dict:
        """Find the most similar stored ticket."""
        self.load()

        if not self.is_available():
            return {
                "is_duplicate": False,
                "duplicate_ticket_id": None,
                "similarity": 0.0,
            }

        active_threshold = (
            threshold
            if threshold is not None
            else SIMILARITY_THRESHOLD
        )

        with self._lock:
            tickets = list(self._tickets)

        if not tickets:
            return {
                "is_duplicate": False,
                "duplicate_ticket_id": None,
                "similarity": 0.0,
            }

        query_embedding = self.model.encode(
            text,
            convert_to_tensor=True,
        )

        best_score = 0.0
        best_id = None

        for ticket_id, stored_embedding, _ in tickets:
            score = util.cos_sim(
                query_embedding,
                stored_embedding,
            ).item()

            if score > best_score:
                best_score = score
                best_id = ticket_id

        is_duplicate = best_score >= active_threshold

        return {
            "is_duplicate": is_duplicate,
            "duplicate_ticket_id": best_id if is_duplicate else None,
            "similarity": round(best_score, 4),
        }
