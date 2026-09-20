-- SUPERSEDED: do not apply. Use supabase/migrations/20260919000100_family_stars.sql.
-- PostgreSQL 15+. Earlier preparatory server-only draft, retained for reference.
BEGIN;

CREATE SCHEMA star_app;
REVOKE ALL ON SCHEMA star_app FROM PUBLIC;

CREATE TABLE star_app.children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Future authenticated parent identifier. Authorization is a backend concern.
  parent_id uuid NOT NULL,
  name text NOT NULL CHECK (name = btrim(name) AND name <> ''),
  time_zone text NOT NULL DEFAULT 'America/New_York',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE star_app.missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES star_app.children(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (name = btrim(name) AND name <> ''),
  -- Text supports multi-code-point emoji such as 🍽️. The future picker supplies it.
  emoji text NOT NULL DEFAULT '⭐' CHECK (btrim(emoji) <> ''),
  stars integer NOT NULL CHECK (stars > 0),
  frequency text NOT NULL CHECK (frequency IN ('once_daily', 'repeatable')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, child_id)
);

CREATE INDEX active_missions_by_child ON star_app.missions(child_id)
  WHERE archived_at IS NULL;

CREATE TABLE star_app.mission_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL,
  child_id uuid NOT NULL,
  -- Reuse this client-generated UUID when retrying the same completion request.
  request_id uuid NOT NULL UNIQUE,
  completed_at timestamptz NOT NULL,
  completed_on date NOT NULL,
  time_zone_snapshot text NOT NULL,
  mission_name_snapshot text NOT NULL,
  emoji_snapshot text NOT NULL,
  stars_awarded integer NOT NULL CHECK (stars_awarded > 0),
  frequency_snapshot text NOT NULL CHECK (frequency_snapshot IN ('once_daily', 'repeatable')),
  -- Undo keeps the original event; it never deletes or recalculates its award.
  undone_at timestamptz,
  FOREIGN KEY (mission_id, child_id)
    REFERENCES star_app.missions(id, child_id) ON DELETE RESTRICT
);

CREATE INDEX completion_history_by_child
  ON star_app.mission_completions(child_id, completed_at DESC);
CREATE INDEX completion_day_lookup
  ON star_app.mission_completions(mission_id, completed_on) WHERE undone_at IS NULL;
CREATE UNIQUE INDEX one_daily_completion
  ON star_app.mission_completions(mission_id, completed_on)
  WHERE frequency_snapshot = 'once_daily' AND undone_at IS NULL;

CREATE FUNCTION star_app.validate_child() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, star_app AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.time_zone) THEN
    RAISE EXCEPTION 'Choose a valid IANA time zone';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_child BEFORE INSERT OR UPDATE ON star_app.children
  FOR EACH ROW EXECUTE FUNCTION star_app.validate_child();

CREATE FUNCTION star_app.protect_mission() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, star_app AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Archive missions instead of deleting them';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.child_id IS DISTINCT FROM OLD.child_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Mission identity cannot be changed';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_mission BEFORE UPDATE OR DELETE ON star_app.missions
  FOR EACH ROW EXECUTE FUNCTION star_app.protect_mission();

CREATE FUNCTION star_app.prepare_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, star_app AS $$
DECLARE
  mission star_app.missions%ROWTYPE;
  zone text;
BEGIN
  -- Serialize awards and mission edits so concurrent requests use consistent rules.
  SELECT * INTO mission FROM star_app.missions WHERE id = NEW.mission_id FOR UPDATE;
  IF NOT FOUND OR mission.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Mission does not exist or is archived';
  END IF;
  SELECT time_zone INTO zone FROM star_app.children WHERE id = mission.child_id;
  NEW.child_id := mission.child_id;
  NEW.completed_at := clock_timestamp();
  NEW.completed_on := (NEW.completed_at AT TIME ZONE zone)::date;
  NEW.time_zone_snapshot := zone;
  NEW.mission_name_snapshot := mission.name;
  NEW.emoji_snapshot := mission.emoji;
  NEW.stars_awarded := mission.stars;
  NEW.frequency_snapshot := mission.frequency;
  NEW.undone_at := NULL;

  -- A switch from repeatable to once-daily counts any existing award today.
  IF mission.frequency = 'once_daily' AND EXISTS (
    SELECT 1 FROM star_app.mission_completions
    WHERE mission_id = mission.id AND completed_on = NEW.completed_on AND undone_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This mission is already complete today';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prepare_completion BEFORE INSERT ON star_app.mission_completions
  FOR EACH ROW EXECUTE FUNCTION star_app.prepare_completion();

CREATE FUNCTION star_app.protect_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, star_app AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Completion history cannot be deleted; use undo';
  END IF;
  IF (to_jsonb(NEW) - 'undone_at') IS DISTINCT FROM (to_jsonb(OLD) - 'undone_at') THEN
    RAISE EXCEPTION 'Completion history is immutable';
  END IF;
  IF OLD.undone_at IS NOT NULL AND NEW.undone_at IS DISTINCT FROM OLD.undone_at THEN
    RAISE EXCEPTION 'An undo cannot be changed';
  END IF;
  IF OLD.undone_at IS NULL AND NEW.undone_at IS NOT NULL THEN
    NEW.undone_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_completion BEFORE UPDATE OR DELETE ON star_app.mission_completions
  FOR EACH ROW EXECUTE FUNCTION star_app.protect_completion();

-- Balance comes from awarded snapshots, never from a mission's current star value.
CREATE VIEW star_app.star_balances AS
SELECT child.id AS child_id,
  COALESCE(sum(event.stars_awarded) FILTER (WHERE event.undone_at IS NULL), 0)::bigint AS balance
FROM star_app.children child
LEFT JOIN star_app.mission_completions event ON event.child_id = child.id
GROUP BY child.id;

REVOKE ALL ON ALL TABLES IN SCHEMA star_app FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA star_app FROM PUBLIC;

-- No seed inserts: parents explicitly create every assigned mission.
COMMIT;
