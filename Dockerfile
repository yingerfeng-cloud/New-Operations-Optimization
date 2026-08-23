FROM ghcr.io/mamba-org/micromamba:2.8.1@sha256:fb18405d6004af757a38ec498a078240b4fd5549146990a484c28bb7e78aace4 AS runtime

WORKDIR /app

COPY --chown=$MAMBA_USER:$MAMBA_USER requirements.txt /app/requirements.txt
COPY --chown=$MAMBA_USER:$MAMBA_USER frontend/package.json frontend/package-lock.json /app/frontend/

RUN micromamba config set download_threads 1 \
    && micromamba config set remote_connect_timeout_secs 60 \
    && micromamba config set remote_max_retries 10 \
    && micromamba config set remote_backoff_factor 2

RUN micromamba install -y -n base -c conda-forge \
    python=3.12 \
    nodejs=22 \
    ipopt \
    pyomo \
    highspy \
    fastapi \
    uvicorn \
    httpx \
    pytest \
    && micromamba clean -a -y

RUN micromamba run -n base python -m pip install --no-cache-dir -r /app/requirements.txt
RUN micromamba run -n base npm ci --prefix /app/frontend

COPY --chown=$MAMBA_USER:$MAMBA_USER . /app
USER root
RUN mkdir -p /app/data /app/reports \
    && chown -R $MAMBA_USER:$MAMBA_USER /app/data /app/reports
USER $MAMBA_USER
RUN micromamba run -n base npm run build --prefix /app/frontend

ENV OPTIFORGE_DATA_DIR=/app/data \
    OPTIFORGE_RUNTIME_STORE=/app/data/runtime_store.json \
    RUNTIME_STORE_PATH=/app/data/runtime_store.json \
    PATH=/opt/conda/bin:$PATH \
    OPTIFORGE_SOLVER_MODE=docker \
    SERVICE_MODE=combined \
    OPTIMIZATION_PLATFORM_BASE_URL=http://127.0.0.1:8000 \
    AGENT_PLATFORM_ACCESS_MODE=in_process \
    AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK=false \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=5 \
    CMD ["/opt/conda/bin/python", "/app/scripts/docker_healthcheck.py"]

CMD ["bash", "/app/scripts/docker_start.sh"]
