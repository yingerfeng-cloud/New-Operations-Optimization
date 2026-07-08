FROM mambaorg/micromamba:1.5.10

WORKDIR /app

COPY --chown=$MAMBA_USER:$MAMBA_USER requirements.txt /app/requirements.txt

RUN micromamba install -y -n base -c conda-forge \
    python=3.11 \
    ipopt \
    pyomo \
    highspy \
    fastapi \
    uvicorn \
    httpx \
    pytest \
    && micromamba clean -a -y

RUN micromamba run -n base python -m pip install --no-cache-dir -r /app/requirements.txt

COPY --chown=$MAMBA_USER:$MAMBA_USER . /app

ENV COPT_DATA_DIR=/app/data \
    COPT_RUNTIME_STORE=/app/data/runtime_store.json \
    RUNTIME_STORE_PATH=/app/data/runtime_store.json \
    COPT_SOLVER_MODE=docker \
    SERVICE_MODE=combined \
    OPTIMIZATION_PLATFORM_BASE_URL=http://127.0.0.1:8000 \
    AGENT_PLATFORM_ACCESS_MODE=in_process \
    AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK=false \
    PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["micromamba", "run", "-n", "base", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
