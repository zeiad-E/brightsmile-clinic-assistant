# Hugging Face Space (Docker SDK) running the LLM gateway.
# The Space disk is ephemeral, so state survives restarts through:
#   - FREEAPI_CONFIG_JSON (secret): admin account + provider keys, applied on every boot
#   - FREEAPI_DB_BACKUP_TARGET/_TOKEN: encrypted SQLite backup in a private HF dataset,
#     restored automatically at startup when the database file is missing
FROM ghcr.io/tashfeenahmed/freellmapi:v0.16.7

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    TRUST_PROXY=1 \
    FREELLMAPI_UPDATE_CHECK=off

EXPOSE 3001
