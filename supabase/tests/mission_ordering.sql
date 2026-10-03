-- LOCAL disposable Supabase only, after all migrations. psql -v ON_ERROR_STOP=1
-- No hosted data is needed; all fixtures roll back.
begin;
create function pg_temp.order_check(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; end;
$$;
create function pg_temp.order_error(command text, expected_state text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise exception 'Wrong error: % %', sqlstate, sqlerrm;
  end;
  raise exception 'Expected error for: %', command;
end;
$$;
do $$ declare temp_schema text; begin
  select nspname into temp_schema from pg_catalog.pg_namespace where oid=pg_my_temp_schema();
  execute format('grant usage on schema %I to authenticated, anon', temp_schema);
end; $$;
grant execute on function pg_temp.order_check(boolean,text), pg_temp.order_error(text,text) to authenticated, anon;
insert into auth.users(id,email) values
 ('11000000-0000-4000-8000-000000000001','order-owner@example.invalid'),
 ('11000000-0000-4000-8000-000000000002','order-outsider@example.invalid'),
 ('11000000-0000-4000-8000-000000000003','order-former-parent@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select set_config('test.order_family',public.create_family('Order test','UTC',gen_random_uuid())::text,true);
insert into public.missions(id,family_id,name,stars,frequency,icon_key) values
 ('21000000-0000-4000-8000-000000000001',current_setting('test.order_family')::uuid,'First',1,'repeatable','book'),
 ('21000000-0000-4000-8000-000000000002',current_setting('test.order_family')::uuid,'Second',1,'repeatable','book'),
 ('21000000-0000-4000-8000-000000000003',current_setting('test.order_family')::uuid,'Third',1,'repeatable','book'),
 ('21000000-0000-4000-8000-000000000004',current_setting('test.order_family')::uuid,'Deleted',1,'repeatable','book');
update public.missions set archived_at=now() where id='21000000-0000-4000-8000-000000000004';
select pg_temp.order_check((select array_agg(sort_order order by id)=array[10,20,30] from public.missions where archived_at is null),'new missions append in household order');
with c as (insert into public.children(family_id,name) values(current_setting('test.order_family')::uuid,'Child') returning id)
select set_config('test.order_child',id::text,true) from c;
select set_config('test.order_event',public.award_mission(current_setting('test.order_child')::uuid,'21000000-0000-4000-8000-000000000001',gen_random_uuid())::text,true);
select set_config('test.order_snapshot',(select to_jsonb(c)::text from public.mission_completions c where c.id=current_setting('test.order_event')::uuid),true);
select * from public.reorder_missions(current_setting('test.order_family')::uuid,array['21000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.order_check((select array_agg(name order by sort_order)=array['Third','First','Second'] from public.missions where archived_at is null),'drop order persists');
select set_config('test.order_ctid',(select ctid::text from public.missions where id='21000000-0000-4000-8000-000000000001'),true);
select * from public.reorder_missions(current_setting('test.order_family')::uuid,array['21000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.order_check((select ctid::text=current_setting('test.order_ctid') from public.missions where id='21000000-0000-4000-8000-000000000001'),'unchanged drop does not update rows');
select pg_temp.order_check((select sort_order=40 from public.missions where id='21000000-0000-4000-8000-000000000004'),'deleted mission is untouched');
select pg_temp.order_check((select to_jsonb(c)=current_setting('test.order_snapshot')::jsonb from public.mission_completions c where c.id=current_setting('test.order_event')::uuid),'completion and visual snapshots unchanged');
select pg_temp.order_check((select balance=1 from public.child_star_balances where child_id=current_setting('test.order_child')::uuid),'star balance unchanged');
select pg_temp.order_error($q$select public.reorder_missions(current_setting('test.order_family')::uuid,array['21000000-0000-4000-8000-000000000001']::uuid[])$q$,'P0001');
select pg_temp.order_error($q$select public.reorder_missions(current_setting('test.order_family')::uuid,array['21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000003']::uuid[])$q$,'P0001');
select pg_temp.order_error($q$select public.reorder_missions(current_setting('test.order_family')::uuid,array['21000000-0000-4000-8000-000000000004','21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000002']::uuid[])$q$,'P0001');
select pg_temp.order_error($q$select public.reorder_missions(current_setting('test.order_family')::uuid,null)$q$,'P0001');
insert into public.missions(id,family_id,name,stars,frequency) values('21000000-0000-4000-8000-000000000005',current_setting('test.order_family')::uuid,'Appended',1,'repeatable');
select pg_temp.order_check((select sort_order=40 from public.missions where id='21000000-0000-4000-8000-000000000005'),'new mission appends after saved order');
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
select set_config('test.order_other_family',public.create_family('Other','UTC',gen_random_uuid())::text,true);
insert into public.missions(id,family_id,name,stars,frequency) values('21000000-0000-4000-8000-000000000006',current_setting('test.order_other_family')::uuid,'Other mission',1,'repeatable');
select pg_temp.order_check((select sort_order=10 from public.missions),'households have independent positions');
select pg_temp.order_error($q$select public.reorder_missions(current_setting('test.order_family')::uuid,'{}'::uuid[])$q$,'42501');
with changed as (update public.missions set sort_order=999 where family_id=current_setting('test.order_family')::uuid returning id)
select pg_temp.order_check((select count(*)=0 from changed),'RLS rejects cross-household direct updates');
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select pg_temp.order_error($q$select public.reorder_missions(current_setting('test.order_family')::uuid,array['21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000006']::uuid[])$q$,'P0001');
reset role;
insert into public.family_memberships(family_id,parent_id,role,left_at) values(current_setting('test.order_family')::uuid,'11000000-0000-4000-8000-000000000003','parent',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
select pg_temp.order_error($q$select public.reorder_missions(current_setting('test.order_family')::uuid,'{}'::uuid[])$q$,'42501');
reset role;
set local role anon;
select pg_temp.order_error($q$select public.reorder_missions(current_setting('test.order_family')::uuid,'{}'::uuid[])$q$,'42501');
reset role;
rollback;
