"""G178: evaluate TypeSafe Jev (a "System One" Choice model) as a candidate
replacement for the Haiku-tier categorisation judge (ENGINE.md's ladder tier
2, `llm_name_check` / `categorise_others_bg` in `app.services.categorisation`).

This package is deliberately kept OUT of `app/`, it is an offline
evaluation harness, never imported by the running API or worker, reads
Mongo directly (never writes, except the standard OpenRouter usage-metering
row `run_haiku.py` produces as a side effect of using the real call path),
and never touches `TODO.md` or the board.

See `README.md` in this directory for how to run each stage.
"""
