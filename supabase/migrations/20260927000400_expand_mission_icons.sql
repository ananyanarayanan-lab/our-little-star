-- Expand visual keys only. Apply after the existing custom-mission migrations.
-- No row, history, permission, or RPC changes. Legacy NULL snapshots remain valid.
begin;
alter table public.missions drop constraint missions_icon_key_known;
alter table public.missions add constraint missions_icon_key_known
  check (icon_key in ('potty', 'clothes', 'toothbrush', 'food', 'cat', 'pet', 'toys', 'laundry', 'dishes', 'bed', 'book', 'shoes', 'backpack', 'helping', 'cleaning', 'star', 'check', 'poop', 'pee', 'toilet', 'bath', 'wash_hands', 'hair', 'pajamas', 'wake_up', 'breakfast', 'snack', 'water', 'cup', 'plate', 'broom', 'trash', 'tidy', 'homework', 'drawing', 'school', 'dog', 'family', 'heart', 'smile', 'trophy'));
alter table public.mission_completions drop constraint completions_icon_key_known;
alter table public.mission_completions add constraint completions_icon_key_known
  check (icon_key_snapshot in ('potty', 'clothes', 'toothbrush', 'food', 'cat', 'pet', 'toys', 'laundry', 'dishes', 'bed', 'book', 'shoes', 'backpack', 'helping', 'cleaning', 'star', 'check', 'poop', 'pee', 'toilet', 'bath', 'wash_hands', 'hair', 'pajamas', 'wake_up', 'breakfast', 'snack', 'water', 'cup', 'plate', 'broom', 'trash', 'tidy', 'homework', 'drawing', 'school', 'dog', 'family', 'heart', 'smile', 'trophy'));
commit;
