-- Tags are private labels: each person has their own tags and sees only their own on an item,
-- even on files other people shared with them (like stars and labels in Drive and Gmail).
CREATE TABLE tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT 'gray' CHECK (color IN ('gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tags_owner_name_idx ON tags (owner_id, lower(name));

CREATE TABLE file_tags (
  file_id  uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_id   uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, tag_id)
);
CREATE INDEX file_tags_tag_idx ON file_tags (tag_id);
