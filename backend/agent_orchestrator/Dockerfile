FROM python:3.12-slim
WORKDIR /app

# Shares the same requirements as historian_api
COPY historian_api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY historian_api/ historian_api/
COPY agent_orchestrator/ agent_orchestrator/

CMD ["uvicorn", "historian_api.main:app", "--host", "0.0.0.0", "--port", "8080"]
