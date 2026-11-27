"""Tests for the tenant-scoped ticket pagination service (Issue #4185).

Covers the acceptance criteria for GET /tickets: tenant isolation derived
from the authenticated user's profile, limit (default 25, max 100) and
offset pagination, per-tenant cache keys, and cache invalidation.

Supabase and Redis are replaced with in-memory fakes, following the
mocking style of test_tenant_isolation.py.
"""

import fnmatch

import pytest
from fastapi import HTTPException

from backend.services import ticket_pagination_service as service


class FakeResult:
    def __init__(self, data):
        self.data = data


class FakeTable:
    """Minimal chainable stand-in for a Supabase table query."""

    def __init__(self, rows):
        self._rows = list(rows)
        self._filters = {}
        self._single = False
        self._order_field = None
        self._order_desc = False
        self._range = None

    def select(self, *args, **kwargs):
        return self

    def eq(self, field, value):
        self._filters[field] = value
        return self

    def order(self, field, desc=False, **kwargs):
        self._order_field = field
        self._order_desc = desc
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def single(self):
        self._single = True
        return self

    def execute(self):
        rows = [
            row
            for row in self._rows
            if all(row.get(key) == value for key, value in self._filters.items())
        ]
        if self._order_field:
            rows.sort(key=lambda row: row[self._order_field], reverse=self._order_desc)
        if self._single:
            return FakeResult(rows[0] if rows else None)
        if self._range is not None:
            start, end = self._range
            rows = rows[start : end + 1]
        return FakeResult(rows)


class FakeSupabase:
    def __init__(self, tickets, profiles):
        self._tables = {"tickets": tickets, "profiles": profiles}

    def table(self, name):
        return FakeTable(self._tables[name])


class FakeCache:
    """In-memory stand-in for the Redis cache with the same interface."""

    def __init__(self):
        self.store = {}
        self.available = True

    def get_json(self, key):
        return self.store.get(key)

    def set_json(self, key, payload, ttl=None):
        self.store[key] = payload

    def delete_by_pattern(self, pattern):
        keys = [key for key in self.store if fnmatch.fnmatch(key, pattern)]
        for key in keys:
            del self.store[key]
        return len(keys)


def make_tickets(company_id, count):
    """Tickets for one company, oldest first, one minute apart."""
    return [
        {
            "id": f"{company_id}-ticket-{i}",
            "company_id": company_id,
            "created_at": f"2026-11-01T{i // 60:02d}:{i % 60:02d}:00",
        }
        for i in range(count)
    ]


PROFILES = [
    {"id": "user-a", "company_id": "company-a"},
    {"id": "user-b", "company_id": "company-b"},
    {"id": "user-none", "company_id": None},
]


@pytest.fixture(autouse=True)
def fake_cache(monkeypatch):
    cache = FakeCache()
    monkeypatch.setattr(service, "redis_cache", cache)
    return cache


def test_spec_constants():
    assert service.DEFAULT_LIMIT == 25
    assert service.MAX_LIMIT == 100


def test_normalize_pagination_clamps_values():
    assert service.normalize_pagination(25, 0) == (25, 0)
    assert service.normalize_pagination(500, 0) == (100, 0)
    assert service.normalize_pagination(0, -5) == (1, 0)


def test_cache_key_format():
    assert (
        service.build_cache_key("company-a", 25, 0)
        == "helpdesk:tickets:company-a:limit25_offset0"
    )
    assert (
        service.build_cache_key(None, 25, 50)
        == "helpdesk:tickets:all:limit25_offset50"
    )


def test_pagination_returns_correct_slices():
    supabase = FakeSupabase(make_tickets("company-a", 60), PROFILES)

    page1 = service.list_tickets_page(supabase, "company-a", 25, 0)
    page2 = service.list_tickets_page(supabase, "company-a", 25, 25)
    page3 = service.list_tickets_page(supabase, "company-a", 25, 50)

    assert len(page1) == 25
    assert len(page2) == 25
    assert len(page3) == 10
    # Newest first: the first row of page 1 is the last ticket created.
    assert page1[0]["id"] == "company-a-ticket-59"
    seen = [row["id"] for row in page1 + page2 + page3]
    assert len(set(seen)) == 60


def test_limit_is_capped_at_100():
    supabase = FakeSupabase(make_tickets("company-a", 120), PROFILES)
    page = service.list_tickets_page(supabase, "company-a", 500, 0)
    assert len(page) == 100


def test_resolve_company_id_from_profile():
    supabase = FakeSupabase([], PROFILES)
    assert service.resolve_company_id(supabase, "user-a", "user", None) == "company-a"
    assert (
        service.resolve_company_id(supabase, "user-a", "user", "company-a")
        == "company-a"
    )


def test_resolve_company_id_rejects_other_tenant():
    supabase = FakeSupabase([], PROFILES)
    with pytest.raises(HTTPException) as excinfo:
        service.resolve_company_id(supabase, "user-a", "user", "company-b")
    assert excinfo.value.status_code == 403


def test_resolve_company_id_without_tenant_is_400():
    supabase = FakeSupabase([], PROFILES)
    with pytest.raises(HTTPException) as excinfo:
        service.resolve_company_id(supabase, "user-none", "user", None)
    assert excinfo.value.status_code == 400


def test_master_admin_may_read_any_tenant():
    supabase = FakeSupabase([], PROFILES)
    assert (
        service.resolve_company_id(supabase, "admin-1", "master_admin", "company-b")
        == "company-b"
    )
    assert service.resolve_company_id(supabase, "admin-1", "master_admin", None) is None


def test_list_never_returns_other_tenants_tickets():
    tickets = make_tickets("company-a", 30) + make_tickets("company-b", 30)
    supabase = FakeSupabase(tickets, PROFILES)

    page = service.list_tickets_page(supabase, "company-a", 100, 0)

    assert len(page) == 30
    assert all(row["company_id"] == "company-a" for row in page)


def test_second_call_is_served_from_cache(fake_cache):
    supabase = FakeSupabase(make_tickets("company-a", 30), PROFILES)

    first = service.list_tickets_page(supabase, "company-a", 25, 0)
    assert "helpdesk:tickets:company-a:limit25_offset0" in fake_cache.store

    # Empty the table: a cached page must still come back unchanged.
    supabase._tables["tickets"] = []
    second = service.list_tickets_page(supabase, "company-a", 25, 0)
    assert second == first


def test_cache_is_separate_per_tenant(fake_cache):
    tickets = make_tickets("company-a", 5) + make_tickets("company-b", 5)
    supabase = FakeSupabase(tickets, PROFILES)

    page_a = service.list_tickets_page(supabase, "company-a", 25, 0)
    page_b = service.list_tickets_page(supabase, "company-b", 25, 0)

    assert "helpdesk:tickets:company-a:limit25_offset0" in fake_cache.store
    assert "helpdesk:tickets:company-b:limit25_offset0" in fake_cache.store
    assert all(row["company_id"] == "company-a" for row in page_a)
    assert all(row["company_id"] == "company-b" for row in page_b)


def test_invalidation_clears_only_that_tenant(fake_cache):
    tickets = make_tickets("company-a", 5) + make_tickets("company-b", 5)
    supabase = FakeSupabase(tickets, PROFILES)
    service.list_tickets_page(supabase, "company-a", 25, 0)
    service.list_tickets_page(supabase, "company-b", 25, 0)

    service.invalidate_tenant_ticket_cache("company-a")

    assert "helpdesk:tickets:company-a:limit25_offset0" not in fake_cache.store
    assert "helpdesk:tickets:company-b:limit25_offset0" in fake_cache.store


def test_invalidation_also_clears_all_tenants_pages(fake_cache):
    tickets = make_tickets("company-a", 5) + make_tickets("company-b", 5)
    supabase = FakeSupabase(tickets, PROFILES)
    service.list_tickets_page(supabase, "company-a", 25, 0)
    service.list_tickets_page(supabase, "company-b", 25, 0)
    service.list_tickets_page(supabase, None, 25, 0)  # master_admin "all" page
    assert "helpdesk:tickets:all:limit25_offset0" in fake_cache.store

    service.invalidate_tenant_ticket_cache("company-a")

    assert "helpdesk:tickets:company-a:limit25_offset0" not in fake_cache.store
    assert "helpdesk:tickets:all:limit25_offset0" not in fake_cache.store
    assert "helpdesk:tickets:company-b:limit25_offset0" in fake_cache.store


def test_master_admin_role_comes_from_app_metadata():
    from backend.auth_cookie import get_user_role

    # Real Supabase shape: the top-level role claim is "authenticated" for
    # every signed-in user; the application role lives in app_metadata.
    user = {
        "id": "admin-1",
        "role": "authenticated",
        "user_metadata": {},
        "app_metadata": {"role": "master_admin"},
    }
    role = get_user_role(user)
    assert role == "master_admin"

    supabase = FakeSupabase([], PROFILES)
    assert service.resolve_company_id(supabase, "admin-1", role, "company-b") == "company-b"
    assert service.resolve_company_id(supabase, "admin-1", role, None) is None


def test_user_metadata_role_cannot_escalate():
    from backend.auth_cookie import get_user_role

    # user_metadata is editable by the signed-in user in Supabase, so a
    # role planted there must never grant master_admin.
    user = {
        "id": "user-1",
        "role": "authenticated",
        "user_metadata": {"role": "master_admin"},
        "app_metadata": {},
    }
    assert get_user_role(user) != "master_admin"
