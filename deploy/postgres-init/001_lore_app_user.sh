#!/bin/sh
set -eu

: "${POSTGRES_DB:=lore}"
: "${POSTGRES_APP_USER:=lore}"
: "${POSTGRES_APP_PASSWORD:=lore}"

PSQL_USER="${PGUSER:-${POSTGRES_USER:-postgres}}"
PSQL_HOST_ARGS=""
if [ -n "${PGHOST:-}" ]; then
  PSQL_HOST_ARGS="--host=$PGHOST"
fi

psql $PSQL_HOST_ARGS \
  --username "$PSQL_USER" \
  -v ON_ERROR_STOP=1 \
  -v db_name="$POSTGRES_DB" \
  -v app_user="$POSTGRES_APP_USER" \
  -v app_password="$POSTGRES_APP_PASSWORD" \
  --dbname "$POSTGRES_DB" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec

SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'app_user', :'app_password') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'db_name', :'app_user') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user') \gexec
SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'db_name', :'app_user') \gexec
SELECT format('GRANT CREATE, USAGE ON SCHEMA public TO %I', :'app_user') \gexec
EOSQL
