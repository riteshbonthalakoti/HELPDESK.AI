"""
Streaming CSV exporter for ticket audits (issue #3901).

Tickets are serialized one batch at a time and yielded as CSV text, so admin
audits can download very large exports without buffering the whole dataset in
memory. Cell values are sanitized against CSV/formula-injection payloads.
"""

import csv
import io
from typing import Callable, Iterable, Iterator

CSV_COLUMNS = [
    "ticket_id",
    "company_id",
    "company",
    "category",
    "subcategory",
    "priority",
    "status",
    "owner_id",
    "created_at",
    "sla_breach_at",
    "resolved_at",
]

DEFAULT_BATCH_SIZE = 500

# Cells starting with these characters can trigger formula execution when a
# spreadsheet application opens the exported file (CSV formula injection).
_FORMULA_PREFIXES = ("=", "+", "-", "@")


def _safe_cell(value: object) -> str:
    """Normalize a cell value and neutralize spreadsheet formula injection."""
    if value is None:
        return ""
    text = str(value)
    text = text.replace("\r", " ").replace("\n", " ").replace("\x00", "")
    if text.startswith(_FORMULA_PREFIXES):
        text = "'" + text
    return text


def _header_row() -> str:
    buf = io.StringIO()
    csv.writer(buf).writerow(CSV_COLUMNS)
    return buf.getvalue()


def _ticket_row(ticket: dict) -> str:
    buf = io.StringIO()
    csv.writer(buf).writerow([_safe_cell(ticket.get(col)) for col in CSV_COLUMNS])
    return buf.getvalue()


def stream_tickets_csv(
    fetch_batch: Callable[[int, int], Iterable[dict]],
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> Iterator[str]:
    """
    Yield CSV text for every ticket returned by ``fetch_batch(offset, batch_size)``.

    ``fetch_batch`` is expected to return an iterable of ticket dicts (or an
    empty iterable once the dataset is exhausted). Rows are streamed incrementally
    rather than buffered as a single string.
    """
    yield _header_row()
    offset = 0
    while True:
        batch = list(fetch_batch(offset, batch_size))
        if not batch:
            break
        for ticket in batch:
            yield _ticket_row(ticket)
        if len(batch) < batch_size:
            break
        offset += batch_size
