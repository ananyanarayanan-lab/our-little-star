-- LOCAL disposable Supabase only. Run as postgres with psql -v ON_ERROR_STOP=1.
-- Auth fixtures and all data changes roll back. These are real authenticated-role tests.
begin;
create function pg_temp.check_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; end;
$$;
create function pg_temp.expect_error(command text, expected_state text, message_part text default '')
returns void language plpgsql as $$
begin
  begin
    execute command;
  exception when others then
    if sqlstate = expected_state and position(message_part in sqlerrm) > 0 then return; end if;
    raise exception 'Wrong error: % % (expected % / %)', sqlstate, sqlerrm, expected_state, message_part;
  end;
  raise exception 'FAIL: statement unexpectedly succeeded: %', command;
end;
$$;
do $$
declare temp_schema text;
begin
  select nspname into temp_schema from pg_catalog.pg_namespace where oid = pg_my_temp_schema();
  execute format('grant usage on schema %I to authenticated, anon', temp_schema);
end;
$$;
grant execute on function pg_temp.check_true(boolean,text), pg_temp.expect_error(text,text,text) to authenticated, anon;
insert into auth.users(id, email) values
 ('10000000-0000-4000-8000-000000000001','stars-owner@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','stars-parent@example.invalid'),
 ('10000000-0000-4000-8000-000000000003','stars-outsider@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('test.family', public.create_family('Test family','America/New_York','20000000-0000-4000-8000-000000000001')::text,true);
select pg_temp.check_true(public.create_family('Test family','America/New_York','20000000-0000-4000-8000-000000000001')::text = current_setting('test.family'), 'family bootstrap retry');
select pg_temp.expect_error($q$select public.create_family('Bad','Invalid/Zone',gen_random_uuid())$q$,'P0001','IANA');
select pg_temp.expect_error($q$select public.create_family('Missing zone',null,gen_random_uuid())$q$,'P0001','IANA');
-- New York midnight changes UTC offset seasonally; no fixed EST offset.
select pg_temp.check_true(
  ('2026-01-15 04:59:59+00'::timestamptz at time zone 'America/New_York')::date = date '2026-01-14'
  and ('2026-01-15 05:00:00+00'::timestamptz at time zone 'America/New_York')::date = date '2026-01-15',
  'Eastern winter daily boundary');
select pg_temp.check_true(
  ('2026-07-15 03:59:59+00'::timestamptz at time zone 'America/New_York')::date = date '2026-07-14'
  and ('2026-07-15 04:00:00+00'::timestamptz at time zone 'America/New_York')::date = date '2026-07-15',
  'Eastern summer daily boundary');
select pg_temp.check_true(
  ('2026-03-08 07:00:00+00'::timestamptz at time zone 'America/New_York') = timestamp '2026-03-08 03:00:00'
  and ('2026-11-01 06:00:00+00'::timestamptz at time zone 'America/New_York') = timestamp '2026-11-01 01:00:00',
  'Eastern daylight saving transitions');
with c as (insert into public.children(family_id,name) values(current_setting('test.family')::uuid,'Sally') returning id)
select set_config('test.child',id::text,true) from c;
select pg_temp.check_true((select count(*) = 0 from public.missions), 'no automatically assigned missions');
with m as (insert into public.missions(family_id,name,stars,frequency) values(current_setting('test.family')::uuid,'Brush teeth',2,'once_daily') returning id)
select set_config('test.daily',id::text,true) from m;
with m as (insert into public.missions(family_id,name,stars,frequency) values(current_setting('test.family')::uuid,'Help out',3,'repeatable') returning id)
select set_config('test.repeat',id::text,true) from m;
with r as (insert into public.rewards(family_id,name,star_cost) values(current_setting('test.family')::uuid,'Toy',5) returning id)
select set_config('test.reward',id::text,true) from r;
select pg_temp.check_true((select emoji = '⭐' from public.missions where id = current_setting('test.daily')::uuid), 'emoji default');
select pg_temp.expect_error($q$insert into public.missions(family_id,name,stars,frequency) values(current_setting('test.family')::uuid,'Bad',0,'once_daily')$q$,'23514');
select pg_temp.expect_error($q$insert into public.rewards(family_id,name,star_cost) values(current_setting('test.family')::uuid,'Bad',-1)$q$,'23514');
select pg_temp.expect_error($q$insert into public.family_memberships(family_id,parent_id,role) values(current_setting('test.family')::uuid,auth.uid(),'owner')$q$,'42501');
select pg_temp.expect_error($q$update public.family_memberships set role = 'owner'$q$,'42501');
select pg_temp.expect_error($q$update public.families set time_zone = 'UTC'$q$,'42501');
select pg_temp.expect_error($q$delete from public.missions$q$,'42501');
select pg_temp.expect_error($q$update public.mission_completions set stars_earned = 99$q$,'42501');
select pg_temp.expect_error($q$insert into public.reward_redemptions default values$q$,'42501');

-- Owner-targeted invitation; knowing the invitation/family ID is not enough.
select set_config('test.invite',public.invite_parent(current_setting('test.family')::uuid,'10000000-0000-4000-8000-000000000002')::text,true);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_error($q$select public.accept_parent_invitation(current_setting('test.invite')::uuid)$q$,'42501');
select pg_temp.check_true((select count(*) = 0 from public.children), 'outsider cannot read children');
select pg_temp.check_true((select count(*) = 0 from public.families), 'outsider cannot read families');
select pg_temp.check_true((select count(*) = 0 from public.child_star_balances), 'balance view respects RLS');
select pg_temp.expect_error($q$insert into public.children(family_id,name) values(current_setting('test.family')::uuid,'Intruder')$q$,'42501');
select pg_temp.expect_error($q$select public.award_mission(current_setting('test.child')::uuid,current_setting('test.daily')::uuid,gen_random_uuid())$q$,'42501');
select set_config('test.other_family', public.create_family('Other','UTC',gen_random_uuid())::text,true);
with r as (insert into public.rewards(family_id,name,star_cost) values(current_setting('test.other_family')::uuid,'Other reward',1) returning id)
select set_config('test.other_reward',id::text,true) from r;
with c as (insert into public.mission_categories(family_id,name) values(current_setting('test.other_family')::uuid,'Other category') returning id)
select set_config('test.other_category',id::text,true) from c;
with m as (insert into public.missions(family_id,name,stars,frequency) values(current_setting('test.other_family')::uuid,'Other mission',1,'repeatable') returning id)
select set_config('test.other_mission',id::text,true) from m;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select public.accept_parent_invitation(current_setting('test.invite')::uuid);
select public.accept_parent_invitation(current_setting('test.invite')::uuid);
select pg_temp.check_true((select count(*) = 1 from public.children), 'invited parent shares family');
select pg_temp.expect_error($q$select public.invite_parent(current_setting('test.family')::uuid,'10000000-0000-4000-8000-000000000003')$q$,'42501');
select pg_temp.expect_error($q$update public.children set selected_reward_id = current_setting('test.other_reward')::uuid where id = current_setting('test.child')::uuid$q$,'23503');
select pg_temp.expect_error($q$update public.missions set category_id = current_setting('test.other_category')::uuid where id = current_setting('test.daily')::uuid$q$,'23503');
select pg_temp.expect_error($q$select public.redeem_reward(current_setting('test.child')::uuid,current_setting('test.other_reward')::uuid,gen_random_uuid())$q$,'P0001','unavailable');
select pg_temp.expect_error($q$select public.award_mission(current_setting('test.child')::uuid,current_setting('test.other_mission')::uuid,gen_random_uuid())$q$,'P0001','unavailable');

-- Award, exact retry, duplicate daily request, family date, and snapshot preservation.
select set_config('test.event',public.award_mission(current_setting('test.child')::uuid,current_setting('test.daily')::uuid,'30000000-0000-4000-8000-000000000001')::text,true);
select pg_temp.check_true(public.award_mission(current_setting('test.child')::uuid,current_setting('test.daily')::uuid,'30000000-0000-4000-8000-000000000001')::text = current_setting('test.event'),'award retry');
select pg_temp.expect_error($q$select public.award_mission(current_setting('test.child')::uuid,current_setting('test.daily')::uuid,gen_random_uuid())$q$,'P0001','already completed');
select pg_temp.check_true((select completed_on = (completed_at at time zone 'America/New_York')::date and time_zone_snapshot = 'America/New_York' and recorded_by = auth.uid() from public.mission_completions where id = current_setting('test.event')::uuid),'family timezone and actor');
-- A different parent/device cannot award the same child/mission again that family day.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local time zone 'Asia/Tokyo';
select pg_temp.expect_error($q$select public.award_mission(current_setting('test.child')::uuid,current_setting('test.daily')::uuid,gen_random_uuid())$q$,'P0001','already completed');
select pg_temp.check_true((select time_zone='America/New_York' from public.families where id=current_setting('test.family')::uuid),'family zone independent of session zone');
set local time zone 'UTC';
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
update public.missions set stars=9,name='New name',emoji='🪥' where id=current_setting('test.daily')::uuid;
select pg_temp.check_true((select stars_earned=2 and mission_name_snapshot='Brush teeth' and emoji_snapshot='⭐' from public.mission_completions where id=current_setting('test.event')::uuid),'historical amount/name/emoji unchanged');
select public.undo_completion(current_setting('test.event')::uuid,'40000000-0000-4000-8000-000000000001');
select public.undo_completion(current_setting('test.event')::uuid,'40000000-0000-4000-8000-000000000001');
select pg_temp.check_true((select balance=0 from public.child_star_balances where child_id=current_setting('test.child')::uuid),'undo once');
select pg_temp.check_true((select undone_at is not null and undone_by=auth.uid() and stars_earned=2 from public.mission_completions where id=current_setting('test.event')::uuid),'undo retains audit');
select set_config('test.new_event',public.award_mission(current_setting('test.child')::uuid,current_setting('test.daily')::uuid,gen_random_uuid())::text,true);
select public.award_mission(current_setting('test.child')::uuid,current_setting('test.repeat')::uuid,'30000000-0000-4000-8000-000000000002');
select public.award_mission(current_setting('test.child')::uuid,current_setting('test.repeat')::uuid,'30000000-0000-4000-8000-000000000003');
select public.award_mission(current_setting('test.child')::uuid,current_setting('test.repeat')::uuid,'30000000-0000-4000-8000-000000000003');
select pg_temp.check_true((select balance=15 from public.child_star_balances where child_id=current_setting('test.child')::uuid),'repeatable twice, retry once');
update public.missions set frequency='once_daily' where id=current_setting('test.repeat')::uuid;
select pg_temp.expect_error($q$select public.award_mission(current_setting('test.child')::uuid,current_setting('test.repeat')::uuid,gen_random_uuid())$q$,'P0001','already completed');
update public.missions set archived_at=now() where id=current_setting('test.daily')::uuid;
select pg_temp.check_true((select balance=15 from public.child_star_balances where child_id=current_setting('test.child')::uuid),'archive preserves balance');
select pg_temp.expect_error($q$select public.award_mission(current_setting('test.child')::uuid,current_setting('test.daily')::uuid,gen_random_uuid())$q$,'P0001','unavailable');
update public.children set selected_reward_id=current_setting('test.reward')::uuid where id=current_setting('test.child')::uuid;
select set_config('test.redemption',public.redeem_reward(current_setting('test.child')::uuid,current_setting('test.reward')::uuid,'50000000-0000-4000-8000-000000000001')::text,true);
select pg_temp.check_true(public.redeem_reward(current_setting('test.child')::uuid,current_setting('test.reward')::uuid,'50000000-0000-4000-8000-000000000001')::text=current_setting('test.redemption'),'redemption retry');
update public.rewards set name='New reward',star_cost=6 where id=current_setting('test.reward')::uuid;
select pg_temp.check_true((select stars_spent=5 and reward_name_snapshot='Toy' from public.reward_redemptions where id=current_setting('test.redemption')::uuid),'redemption snapshot');
select public.redeem_reward(current_setting('test.child')::uuid,current_setting('test.reward')::uuid,gen_random_uuid());
select pg_temp.check_true((select balance=4 from public.child_star_balances where child_id=current_setting('test.child')::uuid),'ledger balance');
select pg_temp.expect_error($q$select public.undo_completion(current_setting('test.new_event')::uuid,gen_random_uuid())$q$,'P0001','already been spent');
select pg_temp.expect_error($q$select public.redeem_reward(current_setting('test.child')::uuid,current_setting('test.reward')::uuid,gen_random_uuid())$q$,'P0001','Not enough stars');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select pg_temp.check_true((select count(*)=0 from public.mission_completions),'outsider cannot read history');
select pg_temp.expect_error($q$select public.undo_completion(current_setting('test.event')::uuid,gen_random_uuid())$q$,'42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select * from public.children$q$,'42501');
select pg_temp.expect_error($q$select public.create_family('No','UTC',gen_random_uuid())$q$,'42501');
reset role;
rollback;
\echo 'PASS: family isolation, invitations, cross-family FKs, snapshots, daily/repeatable awards, undo, and redemption checks'
