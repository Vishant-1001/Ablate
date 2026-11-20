FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml ./
COPY ablate_tx ./ablate_tx
COPY services ./services
COPY agent ./agent
COPY run_all.py ./
RUN pip install --no-cache-dir .
ENV PORT=8000 ABLATE_DATA_DIR=/app/data
EXPOSE 8000
CMD ["python", "run_all.py"]
