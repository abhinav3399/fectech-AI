FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY model_service/requirements.txt ./model_service/requirements.txt
RUN pip install --no-cache-dir -r model_service/requirements.txt

COPY model_service/ ./model_service/

ENV MODEL_SERVICE_PORT=10000
ENV MODEL_3D_PIPELINE=C
ENV MODEL_3D_MAX_CONCURRENT=1

EXPOSE 10000

CMD ["sh", "-c", "uvicorn model_service.app:app --host 0.0.0.0 --port ${PORT:-10000}"]
