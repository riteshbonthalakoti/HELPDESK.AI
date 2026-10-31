"""
Unit tests for the streaming CSV exporter (issue #3901).

Run with:  pytest backend/tests/test_csv_exporter.py -v
"""

import csv
import io
import unittest

from backend.services.csv_exporter import CSV_COLUMNS, _safe_cell, stream_tickets_csv


def _parse(csv_text: str):
    return list(csv.reader(io.StringIO(csv_text)))


class CsvExporterTests(unittest.TestCase):
    def test_header_row_emitted_first(self):
        rows = list(stream_tickets_csv(lambda offset, size: []))
        parsed = _parse("".join(rows))
        self.assertEqual(parsed, [CSV_COLUMNS])

    def test_single_batch(self):
        tickets = [
            {
                "ticket_id": "T-1",
                "company_id": "acme",
                "company": "Acme Inc",
                "category": "Hardware",
                "subcategory": "Laptop",
                "priority": "high",
                "status": "open",
                "owner_id": "u-1",
                "created_at": "2026-01-01T00:00:00Z",
                "sla_breach_at": "2026-01-02T00:00:00Z",
                "resolved_at": "",
            }
        ]
        rows = list(stream_tickets_csv(lambda offset, size: tickets if offset == 0 else []))
        parsed = _parse("".join(rows))
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[1][0], "T-1")
        self.assertEqual(parsed[1][1], "acme")
        self.assertEqual(parsed[1][5], "high")

    def test_paginates_until_exhausted(self):
        calls = []

        def fetch_batch(offset, size):
            calls.append(offset)
            if offset == 0:
                return [{"ticket_id": f"T-{i}", "company_id": "acme"} for i in range(3)]
            if offset == 3:
                return [{"ticket_id": "T-x", "company_id": "acme"}]
            return []

        rows = list(stream_tickets_csv(fetch_batch, batch_size=3))
        parsed = _parse("".join(rows))
        self.assertEqual(calls, [0, 3])
        self.assertEqual(len(parsed), 5)

    def test_missing_fields_default_to_empty(self):
        rows = list(stream_tickets_csv(lambda offset, size: [{"ticket_id": "T-9"}]))
        parsed = _parse("".join(rows))
        self.assertEqual(parsed[1][1], "")
        self.assertEqual(len(parsed[1]), len(CSV_COLUMNS))

    def test_formula_injection_neutralized(self):
        for prefix in ("=", "+", "-", "@"):
            self.assertTrue(_safe_cell(f"{prefix}SUM(A1:A9)").startswith("'"))

    def test_newlines_stripped_from_cells(self):
        self.assertEqual(_safe_cell("line1\nline2\rline3"), "line1 line2 line3")

    def test_null_bytes_stripped(self):
        self.assertEqual(_safe_cell("dangerous\x00payload"), "dangerouspayload")


if __name__ == "__main__":
    unittest.main()
