-- Extract's AI reading sits behind an access code (docs/spec-corrections.md §23).
-- Wrong codes are counted here so guessing is slowed down: after 10 in an
-- hour from one address, tries are refused for a while. Old rows are deleted
-- as new ones arrive.
CREATE TABLE extract_login_failures (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX extract_login_failures_ip_at ON extract_login_failures (ip, at);
