# Backend image — shared by BOTH Railway services:
#   • web    : default CMD below (uvicorn on $PORT)
#   • worker : override the start command in Railway to
#              arq app.workers.sync_worker.WorkerSettings
# Build context is this directory (backend/). Secrets are supplied as env
# vars in production and are excluded from the image via .dockerignore.
FROM python:3.12-slim AS base
# poppler-utils: required by the PDF statement parser.
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app

FROM base AS deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM deps AS runtime
COPY app ./app
# Railway injects $PORT for the web service; default 8000 for local runs.
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --log-level warning"]
