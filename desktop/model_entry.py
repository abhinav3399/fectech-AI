import os
import uvicorn
from model_service.app import app

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("MODEL_SERVICE_PORT", "8800")))