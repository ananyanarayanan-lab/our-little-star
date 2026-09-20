-- Run against a development database after 001_missions.sql; fixtures roll back.
BEGIN;
DO $$
DECLARE
  child uuid;
  mission uuid;
  event uuid;
  repeat_request uuid := gen_random_uuid();
  snapshot star_app.mission_completions%ROWTYPE;
BEGIN
  INSERT INTO star_app.children(parent_id, name, time_zone)
    VALUES (gen_random_uuid(), 'Test child', 'America/New_York') RETURNING id INTO child;
  IF EXISTS (SELECT 1 FROM star_app.missions WHERE child_id = child) THEN
    RAISE EXCEPTION 'Starter missions were assigned';
  END IF;
  INSERT INTO star_app.missions(child_id, name, stars, frequency)
    VALUES (child, 'Brush teeth', 1, 'once_daily') RETURNING id INTO mission;
  IF (SELECT emoji FROM star_app.missions WHERE id = mission) <> '⭐' THEN
    RAISE EXCEPTION 'Default emoji failed';
  END IF;
  INSERT INTO star_app.mission_completions(mission_id, request_id)
    VALUES (mission, gen_random_uuid()) RETURNING id INTO event;
  BEGIN
    INSERT INTO star_app.mission_completions(mission_id, request_id) VALUES (mission, gen_random_uuid());
    RAISE EXCEPTION 'TEST FAILED: duplicate daily award accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'This mission is already complete today' THEN RAISE; END IF;
  END;
  UPDATE star_app.missions SET name = 'New name', emoji = '🍽️', stars = 3, frequency = 'repeatable' WHERE id = mission;
  SELECT * INTO snapshot FROM star_app.mission_completions WHERE id = event;
  IF snapshot.mission_name_snapshot <> 'Brush teeth' OR snapshot.emoji_snapshot <> '⭐' OR snapshot.stars_awarded <> 1 THEN
    RAISE EXCEPTION 'Edit changed history';
  END IF;
  INSERT INTO star_app.mission_completions(mission_id, request_id) VALUES (mission, repeat_request);
  INSERT INTO star_app.mission_completions(mission_id, request_id) VALUES (mission, gen_random_uuid());
  BEGIN
    INSERT INTO star_app.mission_completions(mission_id, request_id) VALUES (mission, repeat_request);
    RAISE EXCEPTION 'TEST FAILED: request retry earned again';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF (SELECT balance FROM star_app.star_balances WHERE child_id = child) <> 7 THEN
    RAISE EXCEPTION 'Repeatable awards failed';
  END IF;
  UPDATE star_app.missions SET archived_at = now() WHERE id = mission;
  IF (SELECT balance FROM star_app.star_balances WHERE child_id = child) <> 7 THEN
    RAISE EXCEPTION 'Archive changed balance';
  END IF;
  BEGIN
    INSERT INTO star_app.mission_completions(mission_id, request_id) VALUES (mission, gen_random_uuid());
    RAISE EXCEPTION 'TEST FAILED: archived mission accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Mission does not exist or is archived' THEN RAISE; END IF;
  END;
  UPDATE star_app.mission_completions SET undone_at = now() WHERE id = event;
  IF (SELECT balance FROM star_app.star_balances WHERE child_id = child) <> 6 THEN
    RAISE EXCEPTION 'Undo used edited stars instead of original award';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM star_app.mission_completions WHERE id = event AND undone_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Undo lost history';
  END IF;
  BEGIN
    UPDATE star_app.mission_completions SET stars_awarded = 99 WHERE id = event;
    RAISE EXCEPTION 'TEST FAILED: historical award edited';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Completion history is immutable' THEN RAISE; END IF;
  END;
END;
$$;
ROLLBACK;
