from __future__ import annotations

import os

service_mode = os.getenv("SERVICE_MODE", "combined").strip().lower()
if service_mode == "platform":
    from app.platform_main import app
elif service_mode == "agent":
    from app.agent_main import app
else:
    from app.main import app


if __name__ == "__main__":
    import uvicorn

    default_port = 8091 if service_mode == "agent" else 8090
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", str(default_port))))
