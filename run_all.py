"""Start the Ablate proxy (and the three in-process SQLite services) on :8000."""
import uvicorn

from ablate_tx.config import HOST, PORT

if __name__ == "__main__":
    uvicorn.run("ablate_tx.proxy_server:app", host=HOST, port=PORT, log_level="info")
