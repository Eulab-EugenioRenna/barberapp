
CREATE TABLE IF NOT EXISTS connect_sdk_schema(version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS connect_sdk_records(
 namespace text NOT NULL, id text NOT NULL, cipher text NOT NULL,
 expires_at timestamptz NOT NULL, PRIMARY KEY(namespace,id));
CREATE INDEX IF NOT EXISTS connect_sdk_expiry ON connect_sdk_records(expires_at);
INSERT INTO connect_sdk_schema(version) VALUES(1) ON CONFLICT DO NOTHING;
