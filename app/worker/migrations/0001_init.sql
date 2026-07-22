CREATE TABLE waitlist (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  delete_secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);
