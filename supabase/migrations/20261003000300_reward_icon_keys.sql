-- Parents configure household rewards with a stable, app-resolved visual key.
-- Existing rewards keep their names, costs, redemption history, and default to gift.
begin;

alter table public.rewards
  add column if not exists icon_key text not null default 'gift';

alter table public.rewards
  drop constraint if exists rewards_icon_key_known;

alter table public.rewards
  add constraint rewards_icon_key_known check (icon_key in (
    'gift', 'chocolate', 'park', 'toy', 'trophy', 'ice_cream',
    'movie', 'book', 'game', 'bike', 'balloon', 'cookie'
  ));

comment on column public.rewards.icon_key is
  'Stable reward visual key resolved by clients. Never store image URLs, device paths, or raw assets.';

grant insert (family_id, name, star_cost, icon_key) on public.rewards to authenticated;
grant update (name, star_cost, icon_key, archived_at) on public.rewards to authenticated;

commit;