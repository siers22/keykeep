FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN pip install --no-cache-dir uv==0.13.3 && uv sync --locked --no-dev --no-install-project
ENV PATH="/app/.venv/bin:$PATH"
COPY alembic.ini ./
COPY src ./src
COPY web ./web
RUN useradd --system --uid 10001 appuser
USER appuser
EXPOSE 8000
CMD ["uvicorn", "keykeep.main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
