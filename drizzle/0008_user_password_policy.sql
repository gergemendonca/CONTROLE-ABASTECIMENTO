CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY NOT NULL,
  value text NOT NULL
);
ALTER TABLE app_users ADD COLUMN password_change_required integer DEFAULT 0 NOT NULL;
