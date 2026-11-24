"""
Duplicate Detection Service.

Uses sentence-transformers to detect similar tickets.
Includes thread-safe storage, bounded caching, and atomic JSON writes.
"""
import hashlib
import json
import os
import tempfile
import threading
import unicodedata
from collections import OrderedDict
from .cosine_similarity import cosine_similarity_matrix
# Share locks between service instances using the same storage file.
_STORAGE_LOCKS = {}
_STORAGE_LOCKS_GUARD = threading.Lock()


def _get_storage_lock(storage_file):
    key = os.path.normcase(os.path.realpath(storage_file))

    with _STORAGE_LOCKS_GUARD:
        if key not in _STORAGE_LOCKS:
            _STORAGE_LOCKS[key] = threading.RLock()

        return _STORAGE_LOCKS[key]

SIMILARITY_THRESHOLD = 0.70

MAX_CACHE_ENTRIES = int(os.getenv("DUPLICATE_CACHE_MAX", "1000"))

if MAX_CACHE_ENTRIES <= 0:
    raise ValueError("DUPLICATE_CACHE_MAX must be a positive integer")

EMBEDDING_CACHE_MAX = int(
    os.getenv("DUPLICATE_EMBEDDING_CACHE_MAX", "1000")
)

if EMBEDDING_CACHE_MAX <= 0:
    raise ValueError(
        "DUPLICATE_EMBEDDING_CACHE_MAX must be a positive integer"
    )
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
        self._load_failed = False

        # Each entry: (ticket_id, embedding, text)
        self._tickets = []
        self._ticket_id_set = set()
        # Active outage-cluster index.
        self._clusters = {}
        self._ticket_cluster_ids = {}
        # Bounded LRU cache for text embeddings.
        self._embedding_cache = OrderedDict()
        self._embedding_cache_lock = threading.Lock()

        self.storage_file = os.path.realpath(
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "data",
                "knowledge_base.json",
            )
        )

        self._lock = _get_storage_lock(self.storage_file)
        os.makedirs(os.path.dirname(self.storage_file), exist_ok=True)

    def is_available(self):
        """Return whether the embedding model loaded successfully."""
        return self._loaded and not self._load_failed and self.model is not None

    def _get_embedding(self, text: str):
        """Return a cached embedding for normalized text or encode it once."""
        normalized_text = unicodedata.normalize(
            "NFKC",
            " ".join(text.split()),
        ).casefold()

        cache_key = hashlib.sha256(
            normalized_text.encode("utf-8")
        ).hexdigest()

        with self._embedding_cache_lock:
            cached_embedding = self._embedding_cache.get(cache_key)

            if cached_embedding is not None:
                self._embedding_cache.move_to_end(cache_key)
                return cached_embedding

        embedding = self.model.encode(
            normalized_text,
            convert_to_tensor=True,
        )

        with self._embedding_cache_lock:
            cached_embedding = self._embedding_cache.get(cache_key)

            if cached_embedding is not None:
                self._embedding_cache.move_to_end(cache_key)
                return cached_embedding

            self._embedding_cache[cache_key] = embedding

            while len(self._embedding_cache) > EMBEDDING_CACHE_MAX:
                self._embedding_cache.popitem(last=False)

        return embedding

    @staticmethod
    def _embedding_array(embedding):
        """Convert embeddings into normalized float32 arrays."""
        if hasattr(embedding, "detach"):
            embedding = embedding.detach().cpu().numpy()

        vector = np.asarray(embedding, dtype=np.float32).reshape(-1)
        norm = np.linalg.norm(vector)

        if norm <= 1e-9:
            return np.zeros_like(vector, dtype=np.float32)

        return vector / norm

    def _index_ticket(self, ticket_id, embedding):
        """Assign a ticket to its nearest outage cluster or create one."""
        if np is None:
            return

        vector = self._embedding_array(embedding)

        if self._clusters:
            cluster_ids = list(self._clusters)
            centroids = np.vstack([
                self._clusters[cid]["centroid"]
                for cid in cluster_ids
            ])

            scores = cosine_similarity_matrix(
                vector,
                centroids,
            )
            best_index = int(np.argmax(scores))
            best_score = float(scores[best_index])

            if best_score >= SIMILARITY_THRESHOLD:
                cluster_id = cluster_ids[best_index]
                cluster = self._clusters[cluster_id]

                cluster["ticket_ids"].append(ticket_id)

                # Update and normalize the cluster centroid.
                member_embeddings = [
                    self._embedding_array(item_embedding)
                    for item_id, item_embedding, _ in self._tickets
                    if item_id in cluster["ticket_ids"]
                ]

                centroid = np.mean(
                    np.vstack(member_embeddings),
                    axis=0,
                )
                norm = np.linalg.norm(centroid)
                cluster["centroid"] = centroid / max(float(norm), 1e-9)

                self._ticket_cluster_ids[ticket_id] = cluster_id
                return

        # No sufficiently similar cluster exists.
        cluster_id = f"outage-{ticket_id}"

        norm = np.linalg.norm(vector)
        centroid = vector / max(float(norm), 1e-9)

        self._clusters[cluster_id] = {
            "centroid": centroid,
            "ticket_ids": [ticket_id],
        }
        self._ticket_cluster_ids[ticket_id] = cluster_id

    def _rebuild_cluster_index(self):
        """Rebuild the active cluster index from loaded tickets."""
        self._clusters.clear()
        self._ticket_cluster_ids.clear()

        for ticket_id, embedding, _ in self._tickets:
            self._index_ticket(ticket_id, embedding)

    def load(self):
        """Load the embedding model and the most recent cached tickets."""
        with self._lock:
            if self._loaded or self._load_failed:
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

                        if not isinstance(text, str):
                            raise ValueError("ticket text must be a string")

                        embedding = self._get_embedding(text)

                        loaded_tickets.append(
                            (ticket_id, embedding, text)
                        )

                    except (KeyError, TypeError, ValueError) as exc:
                        print(
                            f"[DuplicateService] Skipping invalid entry: {exc}"
                        )

                self._tickets = loaded_tickets
                self._ticket_id_set = {
                    ticket_id for ticket_id, _, _ in loaded_tickets
                }
                self._rebuild_cluster_index()
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
            directory = os.path.dirname(self.storage_file)
            temp_file = None

            try:
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

                # Create a unique temporary file in the same directory.
                with tempfile.NamedTemporaryFile(
                    mode="w",
                    encoding="utf-8",
                    dir=directory,
                    prefix=".knowledge_base_",
                    suffix=".tmp",
                    delete=False,
                ) as file:
                    temp_file = file.name
                    json.dump(data, file, indent=2)

                # Atomic replacement prevents partially written JSON.
                os.replace(temp_file, self.storage_file)

                try:
                    print(
                        f"[DuplicateService] Saved ticket {ticket_id} "
                        "to knowledge base."
                    )
                except Exception:
                    pass

                return True

            except Exception as exc:
                print(
                    f"[DuplicateService] Failed to save to disk: {exc}"
                )
                return False

            finally:
                # Remove any temporary file left after a failed save.
                if temp_file is not None:
                    try:
                        os.remove(temp_file)
                    except OSError:
                        pass

    def add_ticket(self, ticket_id: str, text: str) -> bool:
        """Add a ticket once, keeping memory and disk updates synchronized."""
        self.load()

        if not self.is_available():
            return False

        with self._lock:
            if ticket_id in self._ticket_id_set:
                return False

        try:
            embedding = self._get_embedding(text)
        except Exception:
            return False

        with self._lock:
            # Check again in case another thread added this ticket.
            if ticket_id in self._ticket_id_set:
                return False

            # Preserve previous state in case persistence fails.
            previous_tickets = list(self._tickets)
            previous_ticket_ids = set(self._ticket_id_set)

            self._tickets.append((ticket_id, embedding, text))
            self._ticket_id_set.add(ticket_id)

            # Keep the cache bounded and synchronize the ID set.
            self._tickets = self._tickets[-MAX_CACHE_ENTRIES:]
            self._ticket_id_set = {
                existing_id
                for existing_id, _, _ in self._tickets
            }
            self._rebuild_cluster_index()
            # RLock allows save_to_disk to acquire the same lock.
            if not self.save_to_disk(ticket_id, text):
                self._tickets = previous_tickets
                self._ticket_id_set = previous_ticket_ids
                self._rebuild_cluster_index()
                return False

        return True

    def check_duplicate(
        self,
        text: str,
        threshold: float = None,
    ) -> dict:
        """Find duplicates using vectorized outage-cluster similarity."""
        active_threshold = (
            threshold
            if threshold is not None
            else SIMILARITY_THRESHOLD
        )

        if not 0.0 <= active_threshold <= 1.0:
            raise ValueError("threshold must be between 0.0 and 1.0")

        self.load()

        empty_result = {
            "is_duplicate": False,
            "duplicate_ticket_id": None,
            "similarity": 0.0,
            "cluster_id": None,
            "confidence": 0.0,
        }

        if not self.is_available() or np is None:
            return empty_result

        query_embedding = self._get_embedding(text)
        query_vector = self._embedding_array(query_embedding)

        if not np.any(query_vector):
            return empty_result

        with self._lock:
            if not self._tickets or not self._clusters:
                return empty_result

            cluster_ids = list(self._clusters)

            centroids = np.vstack([
                self._clusters[cid]["centroid"]
                for cid in cluster_ids
            ])

            cluster_scores = cosine_similarity_matrix(
                query_vector,
                centroids,
            )

            best_cluster_index = int(np.argmax(cluster_scores))
            cluster_id = cluster_ids[best_cluster_index]

            cluster = self._clusters[cluster_id]
            member_ids = set(cluster["ticket_ids"])

            members = [
                (ticket_id, embedding)
                for ticket_id, embedding, _ in self._tickets
                if ticket_id in member_ids
            ]

            if not members:
                return empty_result

            ticket_ids = [ticket_id for ticket_id, _ in members]

            embeddings = np.vstack([
                self._embedding_array(embedding)
                for _, embedding in members
            ])

            scores = cosine_similarity_matrix(
                query_vector,
                embeddings,
            )

            best_index = int(np.argmax(scores))
            best_score = float(scores[best_index])
            best_id = ticket_ids[best_index]

        is_duplicate = best_score >= active_threshold

        return {
            "is_duplicate": is_duplicate,
            "duplicate_ticket_id": best_id if is_duplicate else None,
            "similarity": round(best_score, 4),
            "cluster_id": cluster_id,
            "confidence": round(best_score, 4),
        }
