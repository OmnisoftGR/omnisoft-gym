-- Omnisoft Gym — 13: διαγραφή ασκήσεων/προγραμμάτων με έλεγχο, στοιχεία επικοινωνίας γυμναστηρίου,
--                    περιγραφή πακέτων (εκτύπωση), νέο γυμναστήριο από τον admin, στοιχεία ιδιοκτητών για τον admin

-- ---------- Στοιχεία επικοινωνίας γυμναστηρίου (για εκτυπώσεις) ----------
alter table public.gyms add column if not exists address text;
alter table public.gyms add column if not exists email text;
alter table public.gyms add column if not exists website text;
alter table public.membership_plans add column if not exists description text;

-- ---------- Διαγραφή άσκησης: μόνο αν δεν χρησιμοποιείται πουθενά ----------
create or replace function public.delete_exercise(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_gym uuid;
begin
  select gym_id into v_gym from exercises where id = p_id;
  if v_gym is null or not public.is_gym_staff(v_gym) then raise exception 'Χωρίς πρόσβαση'; end if;
  if exists (select 1 from program_exercises where exercise_id = p_id)
     or exists (select 1 from workout_sets where exercise_id = p_id) then
    return 'in_use';
  end if;
  delete from exercises where id = p_id;
  return 'deleted';
end $$;

-- ---------- Διαγραφή προγράμματος: μόνο αν δεν έχει καταγεγραμμένες προπονήσεις ----------
-- Αν σβηστεί το ενεργό πρόγραμμα αθλητή, ενεργό γίνεται το προηγούμενο (μεγαλύτερος αριθμός).
create or replace function public.delete_program(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p programs%rowtype; v_prev uuid;
begin
  select * into p from programs where id = p_id;
  if p.id is null or not public.is_gym_staff(p.gym_id) then raise exception 'Χωρίς πρόσβαση'; end if;
  if exists (select 1 from workout_sessions ws join program_days d on d.id = ws.program_day_id where d.program_id = p_id) then
    return 'in_use';
  end if;
  delete from programs where id = p_id;
  if p.athlete_id is not null and p.active then
    select id into v_prev from programs where athlete_id = p.athlete_id order by seq desc nulls last, created_at desc limit 1;
    if v_prev is not null then update programs set active = true, end_date = null where id = v_prev; end if;
  end if;
  return 'deleted';
end $$;

-- ---------- Admin: νέο γυμναστήριο (ενεργό αμέσως) με ιδιοκτήτη από email ----------
-- Ο ιδιοκτήτης φτιάχνει λογαριασμό με το ίδιο email και συνδέεται αυτόματα (tg_link_auth_user).
create or replace function public.admin_create_gym(p_name text, p_owner_name text, p_owner_email text,
                                                   p_city text default null, p_phone text default null, p_plan text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_gym uuid; d platform_settings%rowtype; v_plan text;
begin
  if not public.is_platform_admin() then raise exception 'Μόνο για τη διαχείριση'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_owner_email), '') = '' then raise exception 'Συμπληρώστε όνομα και email ιδιοκτήτη'; end if;
  select * into d from platform_settings where id = 1;
  v_plan := coalesce(nullif(p_plan, ''), d.default_plan);
  insert into gyms (name, city, phone, email, status, approved_at, created_by, plan, max_athletes, paid_until, primary_color, secondary_color)
    values (trim(p_name), nullif(trim(p_city), ''), nullif(trim(p_phone), ''), lower(trim(p_owner_email)), 'active', now(), auth.uid(),
            v_plan, d.default_max_athletes, case when v_plan = 'trial' then current_date + d.default_trial_days end,
            d.default_primary_color, d.default_secondary_color)
    returning id into v_gym;
  insert into gym_members (gym_id, email, full_name, phone, is_owner, is_coach)
    values (v_gym, lower(trim(p_owner_email)), coalesce(nullif(trim(p_owner_name), ''), trim(p_owner_email)), nullif(trim(p_phone), ''), true, true);
  return v_gym;
end $$;

-- ---------- Admin: ιδιοκτήτες/προπονητές όλων των γυμναστηρίων με στοιχεία λογαριασμού ----------
create or replace function public.admin_gym_staff()
returns table (gym_id uuid, member_id uuid, full_name text, email text, phone text, is_owner boolean, is_coach boolean,
               status text, has_account boolean, last_sign_in timestamptz, account_created timestamptz)
language sql stable security definer set search_path = public as $$
  select m.gym_id, m.id, m.full_name, m.email, m.phone, m.is_owner, m.is_coach, m.status,
         m.user_id is not null, u.last_sign_in_at, u.created_at
  from gym_members m left join auth.users u on u.id = m.user_id
  where public.is_platform_admin() and (m.is_owner or m.is_coach)
  order by m.is_owner desc, m.full_name
$$;

revoke execute on function public.delete_exercise(uuid), public.delete_program(uuid),
  public.admin_create_gym(text, text, text, text, text, text), public.admin_gym_staff() from public, anon;
grant execute on function public.delete_exercise(uuid), public.delete_program(uuid),
  public.admin_create_gym(text, text, text, text, text, text), public.admin_gym_staff() to authenticated;
