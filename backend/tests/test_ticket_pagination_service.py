import pytest
from backend.services.ticket_pagination_service import TicketPaginationService


def test_paginate_tickets_returns_correct_window():
    service = TicketPaginationService(default_page_size=2)
    sample_tickets = [
        {"id": 1, "created_at": "2026-08-01T10:00:00Z", "status": "open", "priority": "high"},
        {"id": 2, "created_at": "2026-08-02T10:00:00Z", "status": "open", "priority": "low"},
        {"id": 3, "created_at": "2026-08-03T10:00:00Z", "status": "closed", "priority": "high"},
    ]

    res = service.paginate_tickets(sample_tickets, page=1, limit=2, sort_by="created_at", order="desc")
    assert len(res["items"]) == 2
    assert res["items"][0]["id"] == 3
    assert res["total_items"] == 3
    assert res["total_pages"] == 2
    assert res["has_next"] is True


def test_paginate_tickets_filters_by_status_and_priority():
    service = TicketPaginationService()
    sample_tickets = [
        {"id": 1, "status": "open", "priority": "high"},
        {"id": 2, "status": "closed", "priority": "high"},
        {"id": 3, "status": "open", "priority": "low"},
    ]

    res = service.paginate_tickets(sample_tickets, status="open", priority="high")
    assert res["total_items"] == 1
    assert res["items"][0]["id"] == 1


def test_paginate_tickets_empty_list_returns_default_pagination():
    service = TicketPaginationService()
    res = service.paginate_tickets([])
    assert res["total_items"] == 0
    assert res["items"] == []
    assert res["total_pages"] == 1
