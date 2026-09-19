-- Repositories cached from GitHub at sign-in, so the add-project form can offer
-- a picker without holding on to the user's access token.
CREATE TABLE user_repos (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  private INTEGER NOT NULL DEFAULT 0,
  pushed_at TEXT,
  PRIMARY KEY (user_id, full_name)
);

CREATE INDEX idx_user_repos_user ON user_repos(user_id);
