# =============================================================================
# Multi-stage Dockerfile for HELPDESK.AI Backend (FastAPI + uvicorn)
# Stage 1 (builder): Install production-only Python dependencies
# Stage 2 (production): Minimal runtime image with non-root user
# Stage 3 (dev): Includes test deps, hot reload, and debug tools
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: builder - install production dependencies into user space
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS builder

WORKDIR /app

# Install build dependencies for C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev \
    && apt-get clean

COPY requirements.txt .

# Filter out test/dev packages for production-only install
RUN grep -ivE '^(pytest|pytest-cov|pytest-asyncio|black|ruff|mypy|isort|flake8|ipdb|ipython|debugpy)' \
    requirements.txt > /tmp/prod-requirements.txt && \
    pip install --user --no-cache-dir -r /tmp/prod-requirements.txt

# ---------------------------------------------------------------------------
# Stage 2: production - minimal runtime image, no dev dependencies
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS production

LABEL maintainer="HELPDESK.AI Team" \
      version="3.0.0" \
      description="AI Helpdesk backend production image (optimized)"

# Install only runtime system dependencies (no build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    wget \
    && apt-get clean

# Create non-root user
RUN groupadd --gid 1001 appgroup && \
    useradd --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser

WORKDIR /app

# Copy only installed packages from builder (no build tools, no cache)
COPY --from=builder /root/.local /home/appuser/.local

# Copy application code (respects .dockerignore)
COPY --chown=appuser:appgroup . .

ENV PATH=/home/appuser/.local/bin:$PATH
ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

USER appuser

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD wget --spider -q http://localhost:7860/health || exit 1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]

# ---------------------------------------------------------------------------
# Stage 3: dev - includes test deps, hot reload, and debug tools
# ---------------------------------------------------------------------------
FROM production AS dev

USER root

# Install test and development dependencies
RUN pip install --no-cache-dir \
    pytest pytest-cov pytest-asyncio \
    ruff black mypy isort \
    ipdb debugpy

USER appuser

# Hot reload for development
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860", "--reload"]
