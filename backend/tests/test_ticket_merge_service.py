"""
Unit tests for backend/services/ticket_merge_service.py (issue #4187).

The service is exercised against a small in-memory stand-in for the Supabase
client. It supports the query-builder chain the service uses
(table().select/insert/update/delete().eq().single().execute()), keeps rows per
table, and records every write, so the tests can assert on the resulting data
rather than on mock call counts.

Run: pytest backend/tests/test_ticket_merge_service.py -v
"""

from __future__ import annotations

import itertools
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock, patch

import pytest

from backend.services.ticket_merge_service import (
    TicketMergeService,
    create_merge_service,
)

COMPANY_A = "company-aaaa"
COMPANY_B = "company-bbbb"
PRIMARY_ID = "ticket-primary-11111111"
SECONDARY_ID = "ticket-secondary-22222222"
AGENT_ID = "agent-42"


# ---------------------------------------------------------------------------
# In-memory Supabase stand-in
# ---------------------------------------------------------------------------


class FakeQuery:
    """Chainable query builder mirroring the subset of supabase-py used by the service."""

    def __init__(self, db: "FakeSupabase", table: str) -> None:
        self._db = db
        self.table = table
        self.op: Optional[str] = None
        self.payload: Optional[Dict[str, Any]] = None
        self.filters: List[Tuple[str, Any]] = []
        self.is_single = False

    def select(self, _columns: str = "*") -> "FakeQuery":
        self.op = "select"
        return self

    def insert(self, payload: Dict[str, Any]) -> "FakeQuery":
        self.op = "insert"
        self.payload = payload
        return self

    def update(self, payload: Dict[str, Any]) -> "FakeQuery":
        self.op = "update"
        self.payload = payload
        return self

    def delete(self) -> "FakeQuery":
        self.op = "delete"
        return self

    def eq(self, column: str, value: Any) -> "FakeQuery":
        self.filters.append((column, value))
        return self

    def single(self) -> "FakeQuery":
        self.is_single = True
        return self

    def execute(self) -> SimpleNamespace:
        return self._db.execute(self)


class FakeSupabase:
    """Stores rows per table and can be told to fail on a given operation."""

    def __init__(self, tables: Optional[Dict[str, List[Dict[str, Any]]]] = None) -> None:
        self.tables: Dict[str, List[Dict[str, Any]]] = {
            name: [dict(row) for row in rows] for name, rows in (tables or {}).items()
        }
        self.writes: List[Tuple[str, str, Optional[Dict[str, Any]], List[Tuple[str, Any]]]] = []
        self._failures: Dict[Tuple[str, str], Dict[str, int]] = {}
        self._ids = itertools.count(1)

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)

    def fail_on(self, table: str, op: str, after: int = 0, error: str = "simulated db failure") -> None:
        """Raise on the (after + 1)-th `op` against `table`; earlier calls succeed."""
        self._failures[(table, op)] = {"remaining_ok": after, "error": error}

    def rows(self, table: str) -> List[Dict[str, Any]]:
        return self.tables.setdefault(table, [])

    def execute(self, query: FakeQuery) -> SimpleNamespace:
        failure = self._failures.get((query.table, query.op))
        if failure is not None:
            if failure["remaining_ok"] <= 0:
                raise RuntimeError(failure["error"])
            failure["remaining_ok"] -= 1

        matches = [
            row
            for row in self.rows(query.table)
            if all(row.get(column) == value for column, value in query.filters)
        ]

        if query.op == "select":
            if query.is_single:
                return SimpleNamespace(data=dict(matches[0]) if matches else None)
            return SimpleNamespace(data=[dict(row) for row in matches])

        self.writes.append((query.table, query.op, query.payload, list(query.filters)))

        if query.op == "insert":
            row = {"id": f"{query.table}-{next(self._ids)}", **(query.payload or {})}
            self.rows(query.table).append(row)
            return SimpleNamespace(data=[dict(row)])
        if query.op == "update":
            for row in matches:
                row.update(query.payload or {})
            return SimpleNamespace(data=[dict(row) for row in matches])
        if query.op == "delete":
            self.tables[query.table] = [row for row in self.rows(query.table) if row not in matches]
            return SimpleNamespace(data=[dict(row) for row in matches])
        raise AssertionError(f"unsupported operation: {query.op}")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def make_ticket(ticket_id: str, company_id: str = COMPANY_A, **extra: Any) -> Dict[str, Any]:
    return {
        "id": ticket_id,
        "company_id": company_id,
        "subject": f"Subject of {ticket_id}",
        "status": "open",
        "merged_into": None,
        **extra,
    }


@pytest.fixture
def db() -> FakeSupabase:
    return FakeSupabase(
        {
            "tickets": [make_ticket(PRIMARY_ID), make_ticket(SECONDARY_ID)],
            "ticket_comments": [
                {
                    "id": "c-1",
                    "ticket_id": SECONDARY_ID,
                    "user_id": "user-1",
                    "content": "VPN drops every 5 minutes",
                    "created_at": "2026-11-01T10:00:00+00:00",
                    "is_internal": True,
                },
                {
                    "id": "c-2",
                    "ticket_id": SECONDARY_ID,
                    "user_id": "user-2",
                    "content": "Same here on Wi-Fi",
                    "created_at": "2026-11-01T11:00:00+00:00",
                },
                {
                    "id": "c-3",
                    "ticket_id": PRIMARY_ID,
                    "user_id": "user-3",
                    "content": "Original report",
                    "created_at": "2026-11-01T09:00:00+00:00",
                },
            ],
            "ticket_attachments": [
                {
                    "id": "a-1",
                    "ticket_id": SECONDARY_ID,
                    "file_name": "error.png",
                    "file_path": "attachments/error.png",
                    "file_size": 2048,
                    "file_type": "image/png",
                    "uploaded_by": "user-1",
                    "uploaded_at": "2026-11-01T10:05:00+00:00",
                }
            ],
        }
    )


@pytest.fixture
def service(db: FakeSupabase) -> TicketMergeService:
    return TicketMergeService(db)


def merge(service: TicketMergeService, **overrides: Any) -> Dict[str, Any]:
    kwargs = {
        "primary_ticket_id": PRIMARY_ID,
        "secondary_ticket_id": SECONDARY_ID,
        "merged_by_user_id": AGENT_ID,
        "company_id": COMPANY_A,
    }
    kwargs.update(overrides)
    return service.merge_tickets(**kwargs)


def ticket(db: FakeSupabase, ticket_id: str) -> Dict[str, Any]:
    return next(row for row in db.rows("tickets") if row["id"] == ticket_id)


def comments_for(db: FakeSupabase, ticket_id: str) -> List[Dict[str, Any]]:
    return [row for row in db.rows("ticket_comments") if row["ticket_id"] == ticket_id]


# ---------------------------------------------------------------------------
# Database unavailable / factory
# ---------------------------------------------------------------------------


class TestWithoutDatabase:
    def test_merge_reports_database_unavailable(self) -> None:
        result = merge(TicketMergeService(None))
        assert result == {"success": False, "error": "Database not available"}

    def test_merge_history_is_empty(self) -> None:
        assert TicketMergeService(None).get_merge_history(PRIMARY_ID, COMPANY_A) == []

    def test_unlink_reports_database_unavailable(self) -> None:
        result = TicketMergeService(None).unlink_tickets(PRIMARY_ID, SECONDARY_ID, COMPANY_A)
        assert result == {"success": False, "error": "Database not available"}

    def test_factory_wires_the_client(self, db: FakeSupabase) -> None:
        created = create_merge_service(db)
        assert isinstance(created, TicketMergeService)
        assert created.supabase is db


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class TestValidation:
    def test_missing_primary_ticket(self, service: TicketMergeService, db: FakeSupabase) -> None:
        result = merge(service, primary_ticket_id="ticket-does-not-exist")
        assert result == {"success": False, "error": "Primary ticket not found"}
        assert db.writes == []

    def test_missing_secondary_ticket(self, service: TicketMergeService, db: FakeSupabase) -> None:
        result = merge(service, secondary_ticket_id="ticket-does-not-exist")
        assert result == {"success": False, "error": "Secondary ticket not found"}
        assert db.writes == []

    def test_cannot_merge_ticket_with_itself(self, service: TicketMergeService, db: FakeSupabase) -> None:
        result = merge(service, secondary_ticket_id=PRIMARY_ID)
        assert result == {"success": False, "error": "Cannot merge ticket with itself"}
        assert db.writes == []

    def test_secondary_already_merged(self, service: TicketMergeService, db: FakeSupabase) -> None:
        ticket(db, SECONDARY_ID)["merged_into"] = "ticket-older-33333333"
        result = merge(service)
        assert result == {"success": False, "error": "Secondary ticket already merged"}
        assert db.writes == []

    def test_secondary_from_other_company_is_not_visible(
        self, service: TicketMergeService, db: FakeSupabase
    ) -> None:
        ticket(db, SECONDARY_ID)["company_id"] = COMPANY_B
        result = merge(service)
        assert result == {"success": False, "error": "Secondary ticket not found"}
        assert db.writes == []
        assert ticket(db, SECONDARY_ID)["status"] == "open"

    def test_caller_company_must_own_both_tickets(self, service: TicketMergeService, db: FakeSupabase) -> None:
        result = merge(service, company_id=COMPANY_B)
        assert result == {"success": False, "error": "Primary ticket not found"}
        assert db.writes == []

    def test_rejects_tickets_with_different_company_ids(self) -> None:
        """Defensive check for rows that come back with mismatched tenants."""
        client = MagicMock()
        chain = client.table.return_value.select.return_value.eq.return_value.eq.return_value
        chain.single.return_value.execute.side_effect = [
            SimpleNamespace(data=make_ticket(PRIMARY_ID, COMPANY_A)),
            SimpleNamespace(data=make_ticket(SECONDARY_ID, COMPANY_B)),
        ]
        result = merge(TicketMergeService(client))
        assert result == {"success": False, "error": "Tickets from different companies"}
        client.table.return_value.insert.assert_not_called()
        client.table.return_value.update.assert_not_called()

    def test_lookup_error_is_returned_without_writes(self, service: TicketMergeService, db: FakeSupabase) -> None:
        db.fail_on("tickets", "select", error="connection reset")
        result = merge(service)
        assert result == {"success": False, "error": "connection reset"}
        assert db.writes == []

    @pytest.mark.xfail(
        strict=True,
        reason="Gap noted on #4187: closed (but unmerged) secondary tickets are not rejected yet",
    )
    def test_closed_secondary_ticket_is_rejected(self, service: TicketMergeService, db: FakeSupabase) -> None:
        ticket(db, SECONDARY_ID)["status"] = "closed"
        result = merge(service)
        assert result["success"] is False


# ---------------------------------------------------------------------------
# Successful merge
# ---------------------------------------------------------------------------


class TestSuccessfulMerge:
    def test_result_summary(self, service: TicketMergeService, db: FakeSupabase) -> None:
        result = merge(service)
        assert result["success"] is True
        assert result["primary_ticket_id"] == PRIMARY_ID
        assert result["secondary_ticket_id"] == SECONDARY_ID
        assert result["comments_copied"] == 2
        assert result["attachments_copied"] == 1
        assert result["merge_id"] == db.rows("ticket_merges")[0]["id"]
        assert result["timestamp"].endswith("+00:00")

    def test_comments_are_copied_to_primary(self, service: TicketMergeService, db: FakeSupabase) -> None:
        merge(service)
        copied = [c for c in comments_for(db, PRIMARY_ID) if c["content"].startswith("[Merged from duplicate ticket]")]
        assert [c["content"] for c in copied] == [
            "[Merged from duplicate ticket] VPN drops every 5 minutes",
            "[Merged from duplicate ticket] Same here on Wi-Fi",
        ]
        assert [c["user_id"] for c in copied] == ["user-1", "user-2"]
        assert [c["created_at"] for c in copied] == [
            "2026-11-01T10:00:00+00:00",
            "2026-11-01T11:00:00+00:00",
        ]
        # is_internal is preserved, and defaults to False when missing.
        assert [c["is_internal"] for c in copied] == [True, False]

    def test_original_comments_stay_on_both_tickets(self, service: TicketMergeService, db: FakeSupabase) -> None:
        merge(service)
        secondary_ids = {c["id"] for c in comments_for(db, SECONDARY_ID)}
        assert {"c-1", "c-2"} <= secondary_ids
        assert "c-3" in {c["id"] for c in comments_for(db, PRIMARY_ID)}

    def test_attachments_are_copied_to_primary(self, service: TicketMergeService, db: FakeSupabase) -> None:
        merge(service)
        copied = [a for a in db.rows("ticket_attachments") if a["ticket_id"] == PRIMARY_ID]
        assert len(copied) == 1
        source = db.rows("ticket_attachments")[0]
        for field in ("file_name", "file_path", "file_size", "file_type", "uploaded_by", "uploaded_at"):
            assert copied[0][field] == source[field]

    def test_merge_record_is_written(self, service: TicketMergeService, db: FakeSupabase) -> None:
        merge(service, merge_note="Same VPN outage")
        records = db.rows("ticket_merges")
        assert len(records) == 1
        record = records[0]
        assert record["primary_ticket_id"] == PRIMARY_ID
        assert record["secondary_ticket_id"] == SECONDARY_ID
        assert record["merged_by_user_id"] == AGENT_ID
        assert record["company_id"] == COMPANY_A
        assert record["merge_note"] == "Same VPN outage"
        assert record["merged_at"].endswith("+00:00")

    def test_default_merge_note(self, service: TicketMergeService, db: FakeSupabase) -> None:
        merge(service)
        assert db.rows("ticket_merges")[0]["merge_note"] == "Duplicate ticket merged"

    def test_system_notes_are_added_to_both_tickets(self, service: TicketMergeService, db: FakeSupabase) -> None:
        merge(service)
        primary_notes = [c for c in comments_for(db, PRIMARY_ID) if c.get("is_system")]
        secondary_notes = [c for c in comments_for(db, SECONDARY_ID) if c.get("is_system")]
        assert len(primary_notes) == 1
        assert len(secondary_notes) == 1

        primary_note = primary_notes[0]
        assert SECONDARY_ID[-8:] in primary_note["content"]
        assert f"Subject of {SECONDARY_ID}" in primary_note["content"]
        assert primary_note["is_internal"] is True
        assert primary_note["user_id"] is None

        secondary_note = secondary_notes[0]
        assert PRIMARY_ID[-8:] in secondary_note["content"]
        assert f"Subject of {PRIMARY_ID}" in secondary_note["content"]
        assert secondary_note["is_internal"] is True
        assert secondary_note["user_id"] is None

    def test_note_falls_back_when_subject_missing(self, service: TicketMergeService, db: FakeSupabase) -> None:
        del ticket(db, SECONDARY_ID)["subject"]
        merge(service)
        note = next(c for c in comments_for(db, PRIMARY_ID) if c.get("is_system"))
        assert "(Subject: N/A)" in note["content"]

    def test_secondary_is_closed_and_linked(self, service: TicketMergeService, db: FakeSupabase) -> None:
        merge(service)
        secondary = ticket(db, SECONDARY_ID)
        assert secondary["status"] == "closed"
        assert secondary["resolution"] == "Duplicate - Merged"
        assert secondary["merged_into"] == PRIMARY_ID
        assert secondary["closed_at"].endswith("+00:00")

    def test_primary_ticket_is_not_modified(self, service: TicketMergeService, db: FakeSupabase) -> None:
        before = dict(ticket(db, PRIMARY_ID))
        merge(service)
        assert ticket(db, PRIMARY_ID) == before
        ticket_updates = [w for w in db.writes if w[0] == "tickets" and w[1] == "update"]
        assert [w[3] for w in ticket_updates] == [[("id", SECONDARY_ID)]]

    def test_merge_without_comments_or_attachments(self, db: FakeSupabase) -> None:
        db.tables["ticket_comments"] = []
        db.tables["ticket_attachments"] = []
        result = merge(TicketMergeService(db))
        assert result["success"] is True
        assert result["comments_copied"] == 0
        assert result["attachments_copied"] == 0
        assert ticket(db, SECONDARY_ID)["merged_into"] == PRIMARY_ID

    def test_second_merge_of_same_secondary_is_rejected(self, service: TicketMergeService) -> None:
        assert merge(service)["success"] is True
        assert merge(service) == {"success": False, "error": "Secondary ticket already merged"}


# ---------------------------------------------------------------------------
# Failures part-way through a merge
# ---------------------------------------------------------------------------


class TestMergeFailures:
    def test_unexpected_error_stops_before_closing_secondary(
        self, service: TicketMergeService, db: FakeSupabase
    ) -> None:
        with patch.object(service, "_copy_attachments", side_effect=RuntimeError("storage offline")):
            result = merge(service)
        assert result == {"success": False, "error": "storage offline"}
        assert ticket(db, SECONDARY_ID)["status"] == "open"
        assert ticket(db, SECONDARY_ID)["merged_into"] is None
        assert db.rows("ticket_merges") == []

    def test_merge_record_failure_falls_back_to_unknown_id(
        self, service: TicketMergeService, db: FakeSupabase
    ) -> None:
        db.fail_on("ticket_merges", "insert")
        result = merge(service)
        assert result["success"] is True
        assert result["merge_id"] == "unknown"
        assert ticket(db, SECONDARY_ID)["merged_into"] == PRIMARY_ID

    def test_comment_listing_failure_reports_zero_copied(
        self, service: TicketMergeService, db: FakeSupabase
    ) -> None:
        db.fail_on("ticket_comments", "select")
        result = merge(service)
        assert result["success"] is True
        assert result["comments_copied"] == 0
        assert result["attachments_copied"] == 1

    def test_attachment_listing_failure_reports_zero_copied(
        self, service: TicketMergeService, db: FakeSupabase
    ) -> None:
        db.fail_on("ticket_attachments", "select")
        result = merge(service)
        assert result["success"] is True
        assert result["comments_copied"] == 2
        assert result["attachments_copied"] == 0

    @pytest.mark.xfail(
        strict=True,
        reason="Gap noted on #4187: no rollback when copying comments fails half-way",
    )
    def test_half_copied_comments_are_rolled_back(self, service: TicketMergeService, db: FakeSupabase) -> None:
        db.fail_on("ticket_comments", "insert", after=1)
        result = merge(service)
        copied = [c for c in comments_for(db, PRIMARY_ID) if c["content"].startswith("[Merged from duplicate ticket]")]
        assert result["success"] is False
        assert copied == []
        assert ticket(db, SECONDARY_ID)["status"] == "open"


# ---------------------------------------------------------------------------
# Merge history and unlinking
# ---------------------------------------------------------------------------


class TestMergeHistory:
    @pytest.fixture
    def history_db(self) -> FakeSupabase:
        return FakeSupabase(
            {
                "ticket_merges": [
                    {"id": "m-1", "primary_ticket_id": PRIMARY_ID, "secondary_ticket_id": "t-x", "company_id": COMPANY_A},
                    {"id": "m-2", "primary_ticket_id": "t-y", "secondary_ticket_id": PRIMARY_ID, "company_id": COMPANY_A},
                    {"id": "m-3", "primary_ticket_id": PRIMARY_ID, "secondary_ticket_id": "t-z", "company_id": COMPANY_B},
                    {"id": "m-4", "primary_ticket_id": "t-y", "secondary_ticket_id": "t-x", "company_id": COMPANY_A},
                ]
            }
        )

    def test_returns_merges_as_primary_then_secondary(self, history_db: FakeSupabase) -> None:
        history = TicketMergeService(history_db).get_merge_history(PRIMARY_ID, COMPANY_A)
        assert [m["id"] for m in history] == ["m-1", "m-2"]

    def test_is_scoped_to_company(self, history_db: FakeSupabase) -> None:
        history = TicketMergeService(history_db).get_merge_history(PRIMARY_ID, COMPANY_B)
        assert [m["id"] for m in history] == ["m-3"]

    def test_returns_empty_list_on_error(self, history_db: FakeSupabase) -> None:
        history_db.fail_on("ticket_merges", "select")
        assert TicketMergeService(history_db).get_merge_history(PRIMARY_ID, COMPANY_A) == []


class TestUnlinkTickets:
    @pytest.fixture
    def links_db(self) -> FakeSupabase:
        return FakeSupabase(
            {
                "ticket_links": [
                    {"id": "l-1", "source_ticket_id": PRIMARY_ID, "target_ticket_id": SECONDARY_ID},
                    {"id": "l-2", "source_ticket_id": SECONDARY_ID, "target_ticket_id": PRIMARY_ID},
                    {"id": "l-3", "source_ticket_id": PRIMARY_ID, "target_ticket_id": "t-other"},
                ]
            }
        )

    def test_removes_links_in_both_directions_only(self, links_db: FakeSupabase) -> None:
        result = TicketMergeService(links_db).unlink_tickets(PRIMARY_ID, SECONDARY_ID, COMPANY_A)
        assert result == {"success": True}
        assert [link["id"] for link in links_db.rows("ticket_links")] == ["l-3"]

    def test_reports_delete_errors(self, links_db: FakeSupabase) -> None:
        links_db.fail_on("ticket_links", "delete", error="permission denied")
        result = TicketMergeService(links_db).unlink_tickets(PRIMARY_ID, SECONDARY_ID, COMPANY_A)
        assert result == {"success": False, "error": "permission denied"}
        assert len(links_db.rows("ticket_links")) == 3
