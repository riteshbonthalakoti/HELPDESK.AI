"""
Server-Side Ticket Pagination, Filtering, and Sorting Service.
Provides offset pagination, multi-attribute filtering, and dynamic field sorting for GET /tickets (#3978).
"""

from typing import Any, Dict, List, Optional


class TicketPaginationService:
    """
    Pagination, filtering, and sorting engine for ticket listings.
    """

    def __init__(self, default_page_size: int = 20, max_page_size: int = 100):
        self.default_page_size = default_page_size
        self.max_page_size = max_page_size

    def paginate_tickets(
        self,
        tickets: List[Dict[str, Any]],
        page: int = 1,
        limit: Optional[int] = None,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        sort_by: str = "created_at",
        order: str = "desc",
    ) -> Dict[str, Any]:
        """
        Filter, sort, and paginate tickets list.
        """
        page = max(1, page)
        page_size = limit if limit and limit > 0 else self.default_page_size
        page_size = min(page_size, self.max_page_size)

        filtered = tickets

        # Apply status filter
        if status:
            filtered = [t for t in filtered if t.get("status") == status]

        # Apply priority filter
        if priority:
            filtered = [t for t in filtered if t.get("priority") == priority]

        # Apply sorting
        reverse = (order.lower() == "desc")
        filtered = sorted(
            filtered,
            key=lambda t: t.get(sort_by) or "",
            reverse=reverse,
        )

        # Apply pagination window
        total_items = len(filtered)
        total_pages = (total_items + page_size - 1) // page_size if total_items > 0 else 1
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size

        paginated_items = filtered[start_idx:end_idx]

        return {
            "items": paginated_items,
            "page": page,
            "limit": page_size,
            "total_items": total_items,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        }
