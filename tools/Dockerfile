FROM python:3.11-slim

WORKDIR /app

# Install build deps then runtime deps
COPY tools/requirements.txt ./tools/requirements.txt
RUN python -m pip install --upgrade pip && \
    pip install --no-cache-dir -r tools/requirements.txt && \
    pip cache purge || true

# Copy app code (use read-only mount in compose for easy development)
COPY tools /app/tools
COPY data /app/data

ENV FLASK_ENV=production

EXPOSE 5000

CMD ["gunicorn", "tools.api:APP", "-b", "0.0.0.0:5000", "--workers", "2", "--threads", "2"]
