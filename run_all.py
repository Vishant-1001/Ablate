"""Start the Ablate proxy (and the three in-process SQLite services) on :8000."""
import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run("ablate_tx.proxy_server:app", host=os.environ.get("HOST", "0.0.0.0"),
                port=int(os.environ.get("PORT", "8000")), log_level="info")
