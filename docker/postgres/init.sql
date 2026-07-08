# PostgreSQL init script for EdgeFlow.
# Schema is created by the backend's migration runner on startup - we just
# create the database + user + pgcrypto extension.

SELECT 'CREATE DATABASE edgeflow'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'edgeflow')\gexec

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'edgeflow') THEN
    CREATE ROLE edgeflow WITH LOGIN PASSWORD 'edgeflow';
  END IF;
END$$;

GRANT ALL PRIVILEGES ON DATABASE edgeflow TO edgeflow;

\c edgeflow
CREATE EXTENSION IF NOT EXISTS pgcrypto;
