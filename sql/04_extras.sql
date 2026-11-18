-- Omnisoft Gym — 5: αυτόματη παρουσία όταν καταγράφεται προπόνηση + check-in με κάρτα RFID

create or replace function public.tg_session_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from attendance a
                 where a.member_id = new.athlete_id and a.checked_in_at::date = new.performed_on) then
    insert into attendance (gym_id, member_id, checked_in_at, method)
    values (new.gym_id, new.athlete_id,
            case when new.performed_on = current_date then now() else new.performed_on + time '12:00' end,
            'workout');
  end if;
  return new;
end $$;
create trigger trg_session_attendance after insert on public.workout_sessions
  for each row execute function public.tg_session_attendance();

-- Check-in με κάρτα (USB RFID reader σε tablet λειτουργεί σαν πληκτρολόγιο)
create or replace function public.rfid_checkin(p_gym uuid, p_tag text)
returns text language plpgsql security definer set search_path = public as $$
declare v_member uuid; v_name text;
begin
  if not public.is_gym_staff(p_gym) then raise exception 'Μόνο για το προσωπικό'; end if;
  select id, full_name into v_member, v_name from gym_members
  where gym_id = p_gym and rfid_tag = trim(p_tag) and status = 'active';
  if v_member is null then raise exception 'Άγνωστη κάρτα'; end if;
  if exists (select 1 from attendance where member_id = v_member and checked_in_at::date = current_date) then
    return v_name || ' (ήδη παρών)';
  end if;
  insert into attendance (gym_id, member_id, method) values (p_gym, v_member, 'rfid');
  return v_name;
end $$;

revoke execute on function public.rfid_checkin(uuid, text) from public, anon;
grant execute on function public.rfid_checkin(uuid, text) to authenticated;
revoke execute on function public.tg_session_attendance() from public, anon, authenticated;
