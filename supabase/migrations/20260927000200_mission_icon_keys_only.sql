-- Mission visuals are persisted as validated icon keys only.
-- Requires 20260927000100_custom_missions.sql, which has already migrated
-- existing mission rows to icon_key and moved new completion snapshots to
-- icon_key_snapshot. Historical emoji snapshots remain immutable audit data.
begin;

alter table public.missions
  drop column emoji;

comment on column public.missions.icon_key is
  'Validated icon key (for example cat or toothbrush). The mobile app maps this key to a bundled visual; no URI, path, URL, base64 value, or emoji is stored.';

comment on column public.mission_completions.icon_key_snapshot is
  'Validated mission icon key at award time. New completions always use this field.';

comment on column public.mission_completions.emoji_snapshot is
  'Legacy historical display snapshot only. It is never written by current mission awards and is not the source of a current mission visual.';

commit;
