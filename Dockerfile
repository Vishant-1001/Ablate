FROM node:20-slim AS ui-build
WORKDIR /ui
COPY ui/package*.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml ./
COPY ablate_tx ./ablate_tx
COPY services ./services
COPY agent ./agent
COPY run_all.py ./
RUN pip install --no-cache-dir .
COPY --from=ui-build /ui/dist ./ui/dist
ENV PORT=8000 ABLATE_DATA_DIR=/app/data USE_GEMINI_CACHE=1
EXPOSE 8000
CMD ["python", "run_all.py"]
