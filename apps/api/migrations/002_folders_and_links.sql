-- Folders live in the same table as files (kind = 'folder'), nested through parent_id.
ALTER TABLE files ADD COLUMN kind text NOT NULL DEFAULT 'file' CHECK (kind IN ('file', 'folder'));

-- Deleting a folder forever must delete what is inside it (it used to orphan children to the root).
ALTER TABLE files DROP CONSTRAINT files_parent_id_fkey;
ALTER TABLE files ADD CONSTRAINT files_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES files(id) ON DELETE CASCADE;
CREATE INDEX files_parent_idx ON files (parent_id);

-- "Anyone with the link". The token is stored hashed (for lookup) and sealed (so the owner can copy the
-- same link again). A signed-in person who opens the link is recorded in link_access, which makes the
-- item appear under "Shared with me"; turning the link off removes access immediately.
CREATE TABLE link_shares (
  file_id     uuid PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  token_enc   bytea NOT NULL,
  role        text NOT NULL CHECK (role IN ('viewer', 'editor')),
  enabled     boolean NOT NULL DEFAULT true,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE link_access (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id   uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, file_id)
);
