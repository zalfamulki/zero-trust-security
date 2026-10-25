CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  nim           TEXT UNIQUE,                       -- hanya untuk mahasiswa
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'dosen', 'mahasiswa'))
);

-- Device terdaftar; device_id unik global sehingga device satu user tidak bisa dipakai user lain
CREATE TABLE IF NOT EXISTS devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  device_id     TEXT NOT NULL UNIQUE,
  label         TEXT,
  registered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Yang disimpan adalah hash SHA-256 refresh token, bukan token aslinya
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,                    -- epoch milidetik
  revoked_at  TEXT                                 -- NULL = masih aktif
);

CREATE TABLE IF NOT EXISTS classes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code  TEXT NOT NULL UNIQUE,
  course_name  TEXT NOT NULL,
  lecturer_id  INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS grades (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id     INTEGER NOT NULL REFERENCES classes(id),
  student_id   INTEGER NOT NULL REFERENCES users(id),
  grade_value  REAL NOT NULL CHECK (grade_value >= 0 AND grade_value <= 100),
  is_final     INTEGER NOT NULL DEFAULT 0 CHECK (is_final IN (0, 1)),
  updated_at   TEXT NOT NULL,
  UNIQUE (class_id, student_id)
);

CREATE TABLE IF NOT EXISTS transcripts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL REFERENCES users(id),
  class_id     INTEGER NOT NULL REFERENCES classes(id),
  grade_value  REAL NOT NULL,
  synced_at    TEXT NOT NULL,
  UNIQUE (student_id, class_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at  TEXT NOT NULL,                      -- ISO 8601 UTC
  request_id   TEXT,
  subject      TEXT NOT NULL,                      -- user:<username>(<role>) atau service:<id>
  http_method  TEXT,
  endpoint     TEXT NOT NULL,
  device_id    TEXT,
  decision     TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  reason       TEXT NOT NULL,
  status_code  INTEGER
);
