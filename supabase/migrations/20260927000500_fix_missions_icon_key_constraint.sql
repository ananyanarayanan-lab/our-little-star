-- Standalone repair for the missions constraint after custom missions exists.
-- Safe whether or not 20260927000400_expand_mission_icons.sql was applied.
-- Does not alter any row values or any other table.
begin;
alter table public.missions drop constraint missions_icon_key_known;
alter table public.missions add constraint missions_icon_key_known
  check (icon_key in (
    'potty', 'clothes', 'toothbrush', 'food', 'cat', 'pet', 'toys', 'laundry', 'dishes', 'bed', 'book', 'shoes', 'backpack', 'helping', 'cleaning', 'star', 'check', 'poop', 'pee', 'toilet', 'bath', 'wash_hands', 'hair', 'pajamas', 'wake_up', 'breakfast', 'snack', 'water', 'cup', 'plate', 'broom', 'trash', 'tidy', 'homework', 'drawing', 'school', 'dog', 'family', 'heart', 'smile', 'trophy'
  ));
commit;
