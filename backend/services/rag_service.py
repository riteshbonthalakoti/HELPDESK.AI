from backend.logger import get_logger
logger = get_logger(__name__)
import os
import json
import re
import traceback
from typing import List, Dict, Any

try:
    from sentence_transformers import SentenceTransformer
    _HAS_SENTENCE = True
except ImportError:
    SentenceTransformer = None
    _HAS_SENTENCE = False

from supabase import create_client, Client
from dotenv import load_dotenv

from backend.services.query_expansion_service import QueryExpansionService
from backend.services.hybrid_search_service import HybridSearchService
from backend.services.reranker_service import RerankerService
from backend.services.kb_integration_service import KBIntegrationService

class RagService:
    def __init__(self):
        self.model = None
        self._loaded = False
        self._load_failed = False
        
        load_dotenv()
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")
        if url and key:
            self.supabase: Client = create_client(url, key)
        else:
            self.supabase = None

        # Initialize sub-services
        self.query_expansion = QueryExpansionService()
        self.hybrid_search_svc = HybridSearchService()
        self.reranker = RerankerService()
        self.kb_integration = KBIntegrationService()

    def is_available(self) -> bool:
        """Check if the model is available for RAG queries."""
        return self._loaded and not self._load_failed

    def load(self):
        """Load the SentenceTransformer model for knowledge base queries."""
        if self._loaded or self._load_failed:
            return
        
        if not _HAS_SENTENCE:
            allow_degraded = os.environ.get("ALLOW_DEGRADED_STARTUP", "0") == "1"
            self._load_failed = True
            print("[RAG] sentence-transformers is required but not installed.")
            if allow_degraded:
                print("[RAG] DEGRADED: Continuing without model (ALLOW_DEGRADED_STARTUP=1)")
                self.model = None
                self._loaded = False
                return
            else:
                raise ImportError("sentence-transformers is required")

        print("[RAG] Loading SentenceTransformer for Knowledge Base...")
        try:
            # Check if a local model path is provided
            model_path = os.environ.get("SENTENCE_TRANSFORMER_MODEL_PATH")
            if model_path and os.path.exists(model_path):
                logger.info(f"[RAG] Loading from local path: {model_path}")
                self.model = SentenceTransformer(model_path)
            else:
                # Download from HuggingFace
                self.model = SentenceTransformer('all-MiniLM-L6-v2')
            self._loaded = True
            print("[RAG] Model loaded successfully.")

            # Trigger synchronization of external knowledge base documents on startup
            try:
                self.kb_integration.sync_external_kb(self.supabase, self.model)
            except Exception as e:
                print(f"[RAG] External KB Sync warning: {e}")

        except Exception as e:
            allow_degraded = os.environ.get("ALLOW_DEGRADED_STARTUP", "0") == "1"
            self._load_failed = True
            logger.info(f"[RAG] Failed to load model: {e}")
            if allow_degraded:
                logger.info("[RAG] DEGRADED: Continuing without model (ALLOW_DEGRADED_STARTUP=1)")
                self.model = None
                self._loaded = False
            else:
                raise

    def _get_local_tickets(self) -> List[Dict[str, Any]]:
        """
        Load historical tickets from local cache file if Supabase is offline.
        """
        ticket_cache_paths = [
            os.path.join(os.path.dirname(__file__), "..", "data", "case_history_cache.json"),
            os.path.join(os.path.dirname(__file__), "..", "data", "knowledge_base.json")
        ]
        
        for path in ticket_cache_paths:
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, list):
                            tickets = []
                            for t in data:
                                text = t.get("text") or t.get("description") or ""
                                tickets.append({
                                    "title": f"Historical Ticket #{t.get('ticket_id', 'unknown')[:8]}",
                                    "content": text,
                                    "source": "Ticket",
                                    "category": "General",
                                    "resolution_effectiveness": "85%",
                                    "created_at": "2026-03-30T13:12:13Z",
                                    "url": f"/admin/ticket/{t.get('ticket_id')}"
                                })
                            return tickets
                except Exception as e:
                    print(f"[RAG] Warning reading local ticket cache {path}: {e}")
        return []

    def search_enhanced(self, query: str, threshold: float = 0.75, match_count: int = 5, company_id: str = None) -> Dict[str, Any]:
        """
        Run the fully enhanced semantic & RAG pipeline:
        Query Expansion -> Candidate Retrieval (KB + Tickets) -> Hybrid Scoring -> Reranking -> Output suggestions.
        """
        if not self._loaded:
            return {"best_match": None, "suggestions": [], "recommendations": []}

        try:
            # 1. Query Expansion
            expanded_query = self.query_expansion.expand_query(query)
            
            # 2. Embedding Generation
            query_vector = self.model.encode(expanded_query).tolist()

            # 3. Retrieve Candidate Documents (KB + Tickets)
            candidates = []

            # Retrieve KB Articles
            kb_docs = self.kb_integration.get_external_kb_articles(self.supabase)
            candidates.extend(kb_docs)

            # Retrieve Tickets (Join with profiles or from local cache)
            if self.supabase is not None:
                try:
                    ticket_query = self.supabase.table("tickets").select("id, subject, description, category, created_at, metadata").eq("status", "resolved")
                    if company_id:
                        ticket_query = ticket_query.eq("company", company_id)
                    res = ticket_query.limit(100).execute()
                    if res.data:
                        for t in res.data:
                             desc = t.get("description") or t.get("subject") or ""
                             meta = t.get("metadata") or {}
                             candidates.append({
                                 "id": t.get("id"),
                                 "title": f"Historical Ticket #{str(t.get('id'))[:8]}",
                                 "content": f"Subject: {t.get('subject')}\nDescription: {desc}",
                                 "source": "Ticket",
                                 "category": t.get("category") or "General",
                                 "resolution_effectiveness": meta.get("resolution_effectiveness") or "88%",
                                 "created_at": t.get("created_at"),
                                 "url": f"/admin/ticket/{t.get('id')}"
                             })
                except Exception as e:
                    print(f"[RAG] Failed to retrieve tickets from Supabase: {e}")
                    candidates.extend(self._get_local_tickets())
            else:
                candidates.extend(self._get_local_tickets())

            # 4. Hybrid Search Engine Scoring
            hybrid_scored = self.hybrid_search_svc.search(
                query=expanded_query,
                query_embedding=query_vector,
                candidates=candidates,
                model=self.model
            )

            # 5. Intelligent Reranker Layer
            pre_filtered = [c for c in hybrid_scored if c.get("confidence", 0.0) >= 0.1]
            reranked = self.reranker.rerank(expanded_query, pre_filtered[:50], limit=match_count)

            # Filter results above threshold
            filtered_reranked = [r for r in reranked if r.get("confidence", 0.0) >= threshold]

            best_match = filtered_reranked[0] if filtered_reranked else None

            # Generate Actionable Recommendations from the top matched docs
            recommendations = []
            if best_match:
                content = best_match.get("content") or ""
                steps = re.findall(r'(?:\d+\.\s*|[-*]\s*)([^\n]+)', content)
                if steps:
                    recommendations = [s.strip() for s in steps[:5]]
                else:
                    sentences = [s.strip() for s in content.split(".") if len(s.strip()) > 15]
                    recommendations = sentences[:3]

            if not recommendations and best_match:
                recommendations = [f"Follow the steps outlined in the '{best_match['title']}' guide."]

            return {
                "best_match": best_match,
                "suggestions": filtered_reranked,
                "recommendations": recommendations
            }

        except Exception as e:
            print(f"[RAG ERROR] Enhanced query failed: {e}")
            traceback.print_exc()
            return {"best_match": None, "suggestions": [], "recommendations": []}

    def search_knowledge_base(self, text: str, threshold: float = 0.85, match_count: int = 1):
        """
        Original search method using supabase.rpc for match_articles.
        Enables 100% backward compatibility with unit tests.
        """
        self.load()
        if not self._loaded or not self.supabase or not self.model:
            if self._load_failed:
                logger.info("[RAG] DEGRADED: Knowledge base search skipped (model not available)")
            return None

        try:
            vector = self.model.encode(text).tolist()
            response = self.supabase.rpc(
                'match_articles',
                {
                    'query_embedding': vector,
                    'match_threshold': threshold,
                    'match_count': match_count
                }
            ).execute()

            if response.data and len(response.data) > 0:
                best_match = response.data[0]
                required = {"id", "title", "content", "similarity"}
                if not isinstance(best_match, dict) or not required.issubset(best_match):
                    print("[RAG ERROR] Ignoring malformed knowledge-base result")
                    return None
                similarity = float(best_match["similarity"])
                if not 0.0 <= similarity <= 1.0 or similarity < threshold:
                    return None
                return {
                    "id": best_match["id"],
                    "title": str(best_match["title"])[:500],
                    "content": str(best_match["content"])[:20000],
                    "similarity": similarity
                }
            return None
        except Exception as e:
            logger.error(f"[RAG ERROR] Query failed: {e}")
            return None
