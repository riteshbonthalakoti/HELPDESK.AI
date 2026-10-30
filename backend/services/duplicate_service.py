"""
Duplicate Detection Service
Uses sentence-transformers all-MiniLM-L6-v2 to detect similar tickets.
"""

import uuid
from sentence_transformers import SentenceTransformer, util

SIMILARITY_THRESHOLD = 0.70


import os

class DuplicateService:
    def __init__(self):
        self.model = None
        self._loaded = False
        # In-memory store: list of (ticket_id, embedding, text)
        self._tickets: list[tuple[str, object, str]] = []
        self.storage_file = os.path.join(os.path.dirname(__file__), "..", "data", "knowledge_base.json")
        os.makedirs(os.path.dirname(self.storage_file), exist_ok=True)

    def load(self):
        """Load the sentence-transformer model and saved tickets."""
        if self._loaded:
            return
        
        print("[DuplicateService] Loading model...")
        self.model = SentenceTransformer("all-MiniLM-L6-v2")
        self._loaded = True
        
        if os.path.exists(self.storage_file):
            print(f"[DuplicateService] Loading knowledge base from {self.storage_file}...")
            import json
            try:
                with open(self.storage_file, "r") as f:
                    data = json.load(f)
                    for item in data:
                        text = item["text"]
                        embedding = self.model.encode(text, convert_to_tensor=True)
                        self._tickets.append((item["ticket_id"], embedding, text))
                print(f"[DuplicateService] Loaded {len(self._tickets)} tickets.")
            except Exception as e:
                print(f"[DuplicateService] Error loading storage: {e}")

    def save_to_disk(self, ticket_id: str, text: str):
        """Append a new ticket to the JSON storage."""
        import json
        data = []
        try:
            os.makedirs(os.path.dirname(self.storage_file), exist_ok=True)
            if os.path.exists(self.storage_file):
                with open(self.storage_file, "r") as f:
                    try:
                        data = json.load(f)
                        if not isinstance(data, list):
                            data = []
                    except:
                        data = []
            
            data.append({"ticket_id": ticket_id, "text": text})
            with open(self.storage_file, "w") as f:
                json.dump(data, f, indent=2)
            print(f"[DuplicateService] Saved ticket {ticket_id} to knowledge base.")
        except Exception as e:
            print(f"[DuplicateService] Failed to save to disk: {e}")

    def add_ticket(self, ticket_id: str, text: str):
        """Add a ticket to the in-memory store and persist to disk."""
        self.load()
        embedding = self.model.encode(text, convert_to_tensor=True)
        self._tickets.append((ticket_id, embedding, text))
        self.save_to_disk(ticket_id, text)

    def check_duplicate(self, text: str, threshold: float = None) -> dict:
        """
        Check if a ticket is a duplicate of any stored ticket.

        Args:
            text: The ticket text to check.
            threshold: Optional override for the similarity threshold.

        Returns:
            {
                "is_duplicate": bool,
                "duplicate_ticket_id": str | None,
                "similarity": float
            }
        """
        # Early return for empty or whitespace-only text to prevent unnecessary model loading & division errors
        if not text or not str(text).strip():
            return {
                "is_duplicate": False,
                "duplicate_ticket_id": None,
                "similarity": 0.0,
            }

        self.load()
        
        # Use provided threshold or default to global constant
        active_threshold = threshold if threshold is not None else SIMILARITY_THRESHOLD

        if not self._tickets:
            return {
                "is_duplicate": False,
                "duplicate_ticket_id": None,
                "similarity": 0.0,
            }

        query_embedding = self.model.encode(text, convert_to_tensor=True)

        best_score = 0.0
        best_id = None

        for ticket_id, stored_emb, _ in self._tickets:
            score = util.cos_sim(query_embedding, stored_emb).item()
            if score > best_score:
                best_score = score
                best_id = ticket_id

        is_dup = best_score >= active_threshold

        return {
            "is_duplicate": is_dup,
            "duplicate_ticket_id": best_id if is_dup else None,
            "similarity": round(best_score, 4),
        }
