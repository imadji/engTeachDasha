CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  script TEXT,
  student_script TEXT,
  cards TEXT NOT NULL DEFAULT '[]',
  published INTEGER DEFAULT 0,
  publish_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_publish_key ON lessons(publish_key) WHERE publish_key IS NOT NULL;