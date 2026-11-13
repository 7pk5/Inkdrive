CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub  text NOT NULL UNIQUE,
  email       text NOT NULL,
  name        text NOT NULL,
  avatar      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_email_idx ON users (lower(email));

CREATE TABLE files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  parent_id   uuid REFERENCES files(id) ON DELETE SET NULL,
  revision    integer NOT NULL DEFAULT 1,
  size        integer NOT NULL DEFAULT 0,
  starred     boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_owner_idx ON files (owner_id, updated_at DESC);

-- Scene is opaque Excalidraw JSON, gzip-compressed.
CREATE TABLE file_versions (
  file_id     uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  revision    integer NOT NULL,
  scene       bytea NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, revision)
);

-- Shares are keyed by verified Google email, so an invite works before the
-- invited person has an account, and a forwarded invite email cannot be reused
-- by a different Google account.
CREATE TABLE shares (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id       uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role          text NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, invited_email)
);
CREATE INDEX shares_email_idx ON shares (invited_email);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_family_idx ON sessions (family_id);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid,
  action      text NOT NULL,
  target      text,
  at          timestamptz NOT NULL DEFAULT now()
);
