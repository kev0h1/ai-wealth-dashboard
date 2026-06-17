"""arq worker settings shared by sync and AI workers."""
from app.core.config import REDIS_URL


class WorkerSettings:
    redis_settings_from_dsn = REDIS_URL
    max_jobs = 10
    job_timeout = 300
    keep_result = 3600
