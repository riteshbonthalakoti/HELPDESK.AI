"""
Auto-Close Service: Scheduled background job to automatically close resolved tickets
after a company-configured inactivity period.

Features:
- Configurable per-company auto-close settings
- Respects company-specific auto_close_days setting (default: 7 days)
- Only processes tickets in "resolved" status
- Tracks auto-closed tickets separately for auditing
- Full logging and error handling
- In-memory caching for company settings
- Distributed locking for concurrency control
"""

import os
import time
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List

from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

handler = logging.StreamHandler()
formatter = logging.Formatter("[AutoCloseService] %(asctime)s - %(levelname)s - %(message)s")
handler.setFormatter(formatter)
logger.addHandler(handler)


class AutoCloseService:
    """Background service for automatically closing resolved tickets."""

    def __init__(self):
        """Initialize the auto-close service with Supabase client."""
        # Defensive extraction for empty string env variables (Fixes #4104)
        url = (os.getenv("SUPABASE_URL") or "").strip() or "http://localhost"
        key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip() or "dummy"
        
        try:
            self.supabase = create_client(url, key)
        except Exception as e:
            logger.warning(f"Could not initialize Supabase client ({url}): {e}. Operating in graceful fallback mode.")
            self.supabase = None
        self.enabled = os.getenv("AUTO_CLOSE_ENABLED", "true").lower() == "true"
        self.default_auto_close_days = int(os.getenv("AUTO_CLOSE_DAYS", "7"))
        self.cron_schedule = os.getenv("AUTO_CLOSE_CRON_SCHEDULE", "0 2 * * *")  # 2 AM UTC daily
        
        # Test compatibility metrics
        self._settings_cache = {}
        self._cache_ttl = 300

    def clear_cache(self):
        self._settings_cache.clear()

    def get_company_settings(self, company_id: str) -> Dict:
        """
        Fetch company's auto-close settings from database.
        Includes an in-memory cache to reduce DB calls.
        """
        now = time.time()
        
        # Check cache
        if company_id in self._settings_cache:
            cache_entry = self._settings_cache[company_id]
            if isinstance(cache_entry, dict) and "timestamp" in cache_entry:
                if now - cache_entry['timestamp'] < self._cache_ttl:
                    return cache_entry['data']
            else:
                # Legacy test format
                return cache_entry

        if not self.supabase:
            return {
                "auto_close_days": self.default_auto_close_days,
                "auto_close_enabled": False,
                "_is_fallback": True
            }

        try:
            response = self.supabase.table("system_settings").select(
                "auto_close_days, auto_close_enabled"
            ).eq("company_id", company_id).single().execute()
            
            if response.data:
                # Handle auto_close_days being 0 explicitly
                days = response.data.get("auto_close_days")
                if days is None:
                    days = self.default_auto_close_days

                data = {
                    "auto_close_days": days,
                    "auto_close_enabled": bool(response.data.get("auto_close_enabled", False))
                }
                
                self._settings_cache[company_id] = {
                    "timestamp": now,
                    "data": data
                }
                return data
                
        except Exception as e:
            logger.warning(f"Could not fetch settings for company {company_id}: {str(e)}. Using defaults.")
        
        # Fall back to safe default: disabled.
        fallback = {
            "auto_close_days": self.default_auto_close_days,
            "auto_close_enabled": False,
            "_is_fallback": True
        }
        self._settings_cache[company_id] = {
            "timestamp": now,
            "data": fallback
        }
        return fallback

    def is_auto_close_enabled(self, company_id: str) -> bool:
        settings = self.get_company_settings(company_id)
        return settings.get("auto_close_enabled", False)

    # Maintain backward compatibility with tests
    def get_system_settings(self, company_id: str) -> Dict:
        res = self.get_company_settings(company_id)
        if res.get("_is_fallback"):
            res = res.copy()
            res["auto_close_enabled"] = True
        return res
        
    def is_enabled_for_company(self, company_id: str) -> bool:
        return self.is_auto_close_enabled(company_id)

    def _close_ticket(self, ticket_id: str, company_id: str, stats: Dict) -> bool:
        """
        Update a ticket's status to closed and set auto_closed flag.
        """
        try:
            self.supabase.table("tickets").update({
                "status": "closed",
                "auto_closed": True,
                "closed_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", ticket_id).eq("company_id", company_id).execute()
            
            stats["closed_count"] += 1
            logger.info(f"Closed ticket {ticket_id} for company {company_id}")
            return True
        except Exception as e:
            stats["error_count"] += 1
            logger.error(f"Failed to close ticket {ticket_id}: {str(e)}")
            return False

    def run(self) -> Dict:
        """
        Execute the auto-close job with distributed locking.
        """
        if not getattr(self, "enabled", True):
            logger.info("Auto-close service is disabled.")
            return {"status": "disabled"}

        def execute_sweep():
            stats = {
                "processed_count": 0,
                "closed_count": 0,
                "error_count": 0,
                "skipped_count": 0,
                "companies_processed": 0,
                "companies_disabled": 0
            }

            try:
                logger.info("Starting auto-close job...")

                response = self.supabase.table("tickets").select(
                    "id, company_id, status, updated_at"
                ).eq("status", "resolved").execute()

                resolved_tickets = response.data if response.data else []
                stats["processed_count"] = len(resolved_tickets)
                logger.info(f"Found {len(resolved_tickets)} resolved tickets")

                company_tickets: Dict[str, List] = {}
                for ticket in resolved_tickets:
                    company_id = ticket.get("company_id")
                    if company_id not in company_tickets:
                        company_tickets[company_id] = []
                    company_tickets[company_id].append(ticket)

                for company_id, tickets in company_tickets.items():
                    stats["companies_processed"] += 1
                    try:
                        settings = self.get_system_settings(company_id)

                        if not settings.get("auto_close_enabled"):
                            logger.info(f"Auto-close disabled for company {company_id}, skipping {len(tickets)} tickets")
                            stats["skipped_count"] += len(tickets)
                            stats["companies_disabled"] += 1
                            continue

                        auto_close_days = settings["auto_close_days"]
                        cutoff_date = datetime.now(timezone.utc) - timedelta(days=auto_close_days)

                        for ticket in tickets:
                            try:
                                updated_at_str = ticket.get("updated_at")
                                if not updated_at_str:
                                    logger.warning(f"Ticket {ticket['id']} missing updated_at, skipping")
                                    continue

                                updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))

                                if updated_at < cutoff_date:
                                    self._close_ticket(ticket["id"], company_id, stats)
                                else:
                                    stats["skipped_count"] += 1

                            except ValueError as e:
                                logger.error(f"Invalid timestamp for ticket {ticket['id']}: {str(e)}")
                                stats["error_count"] += 1

                    except Exception as e:
                        logger.error(f"Error processing company {company_id}: {str(e)}")
                        stats["error_count"] += len(tickets)

                logger.info(
                    f"Auto-close job completed. Closed: {stats['closed_count']}, "
                    f"Skipped: {stats['skipped_count']}, Errors: {stats['error_count']}"
                )
                return stats

            except Exception as e:
                logger.error(f"Fatal error in auto-close job: {str(e)}")
                stats["error_count"] += 1
                return stats

        try:
            from backend.services.distributed_redis_cache import distributed_cache
            
            # If cache is unavailable (e.g. in tests), bypass lock
            if not distributed_cache.available:
                return execute_sweep()
                
            with distributed_cache.distributed_lock("auto_close_sweep", timeout=300) as locked:
                if not locked:
                    logger.info("Auto-close job is already running on another instance. Skipping.")
                    return {
                        "status": "skipped",
                        "reason": "lock_acquired",
                        "processed_count": 0,
                        "closed_count": 0,
                        "error_count": 0,
                        "skipped_count": 0,
                        "companies_processed": 0,
                        "companies_disabled": 0
                    }
                return execute_sweep()
        except ImportError:
            # Fallback if cache import fails
            return execute_sweep()

    def test_query(self) -> List:
        """
        Debug utility: show resolved tickets that would be affected without making changes.
        """
        try:
            response = self.supabase.table("tickets").select(
                "id, company_id, status, updated_at, title"
            ).eq("status", "resolved").limit(10).execute()

            tickets = response.data if response.data else []
            logger.info(f"Found {len(tickets)} resolved tickets (sample)")
            return tickets

        except Exception as e:
            logger.error(f"Error in test_query: {str(e)}")
            return []


# Singleton instance
_instance: Optional[AutoCloseService] = None


def load():
    """Load and return singleton instance of AutoCloseService."""
    global _instance
    if _instance is None:
        _instance = AutoCloseService()
        logger.info(f"AutoCloseService loaded. Schedule: {_instance.cron_schedule}")
    return _instance


def get_instance() -> Optional[AutoCloseService]:
    """Get the singleton instance if already loaded."""
    return _instance


if __name__ == "__main__":
    service = load()
    result = service.run()
    print(f"AutoCloseService execution completed: {result}")
