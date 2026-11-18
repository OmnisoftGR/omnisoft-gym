-- =====================================================================
-- Omnisoft Gym — βοηθητικές συναρτήσεις, triggers, RLS, δικαιώματα
-- =====================================================================

-- ---------- Βοηθητικές συναρτήσεις (security definer για να μην «κυκλώνει» το RLS) ----------
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

-- Μέλος ενεργού γυμναστηρίου (οποιοσδήποτε ρόλος)
create or replace function public.is_gym_member(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from gym_members m join gyms y on y.id = m.gym_id
    where m.gym_id = g and m.user_id = auth.uid()
      and m.status = 'active' and y.status = 'active')
$$;

-- Ιδιοκτήτης ή προπονητής ενεργού γυμναστηρίου
create or replace function public.is_gym_staff(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from gym_members m join gyms y on y.id = m.gym_id
    where m.gym_id = g and m.user_id = auth.uid() and (m.is_owner or m.is_coach)
      and m.status = 'active' and y.status = 'active')
$$;

create or replace function public.is_gym_owner(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from gym_members m
    where m.gym_id = g and m.user_id = auth.uid() and m.is_owner and m.status = 'active')
$$;

-- Η εγγραφή μέλους ανήκει στον τρέχοντα χρήστη (σε ενεργό γυμναστήριο)
create or replace function public.is_me(member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from gym_members m join gyms y on y.id = m.gym_id
    where m.id = member and m.user_id = auth.uid()
      and m.status = 'active' and y.status = 'active')
$$;

create or replace function public.can_view_program(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from programs pr
    where pr.id = p and (public.is_gym_staff(pr.gym_id)
                         or (pr.athlete_id is not null and public.is_me(pr.athlete_id))))
$$;

create or replace function public.can_edit_session(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workout_sessions ws
    where ws.id = s and (public.is_gym_staff(ws.gym_id) or public.is_me(ws.athlete_id)))
$$;

-- ---------- Triggers: συνέπεια gym_id στους «παιδικούς» πίνακες ----------
create or replace function public.tg_gym_from_parent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'program_days' then
    select gym_id into new.gym_id from programs where id = new.program_id;
  elsif tg_table_name = 'program_exercises' then
    select gym_id into new.gym_id from program_days where id = new.program_day_id;
  elsif tg_table_name = 'workout_sets' then
    select gym_id into new.gym_id from workout_sessions where id = new.session_id;
  elsif tg_table_name in ('workout_sessions') then
    select gym_id into new.gym_id from gym_members where id = new.athlete_id;
  elsif tg_table_name = 'attendance' then
    select gym_id into new.gym_id from gym_members where id = new.member_id;
  elsif tg_table_name = 'programs' and new.athlete_id is not null then
    select gym_id into new.gym_id from gym_members where id = new.athlete_id;
  end if;
  return new;
end $$;

create trigger trg_a_gym before insert or update on public.program_days
  for each row execute function public.tg_gym_from_parent();
create trigger trg_a_gym before insert or update on public.program_exercises
  for each row execute function public.tg_gym_from_parent();
create trigger trg_a_gym before insert or update on public.workout_sets
  for each row execute function public.tg_gym_from_parent();
create trigger trg_a_gym before insert or update on public.workout_sessions
  for each row execute function public.tg_gym_from_parent();
create trigger trg_a_gym before insert or update on public.attendance
  for each row execute function public.tg_gym_from_parent();
create trigger trg_a_gym before insert or update on public.programs
  for each row execute function public.tg_gym_from_parent();

-- Η άσκηση πρέπει να ανήκει στο ίδιο γυμναστήριο
create or replace function public.tg_check_exercise_gym() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from exercises e where e.id = new.exercise_id and e.gym_id = new.gym_id) then
    raise exception 'Η άσκηση δεν ανήκει σε αυτό το γυμναστήριο';
  end if;
  return new;
end $$;
create trigger trg_b_ex_gym before insert or update on public.program_exercises
  for each row execute function public.tg_check_exercise_gym();
create trigger trg_b_ex_gym before insert or update on public.workout_sets
  for each row execute function public.tg_check_exercise_gym();

-- Μόνο ο ιδιοκτήτης (ή ο διαχειριστής πλατφόρμας) αλλάζει ρόλους ιδιοκτήτη/προπονητή
create or replace function public.tg_member_roles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  if tg_op = 'INSERT' then  -- σύνδεση με υπάρχοντα χρήστη με το ίδιο email
    select id into new.user_id from auth.users where lower(email) = new.email;
  end if;
  if auth.uid() is null or public.is_platform_admin()
     or current_setting('app.registering_gym', true) = 'on' then return new; end if;
  if (tg_op = 'INSERT' and (new.is_owner or new.is_coach))
     or (tg_op = 'UPDATE' and (new.is_owner is distinct from old.is_owner
                              or new.is_coach is distinct from old.is_coach
                              or new.user_id is distinct from old.user_id)) then
    if not public.is_gym_owner(new.gym_id) then
      raise exception 'Μόνο ο ιδιοκτήτης ορίζει προπονητές/ιδιοκτήτες';
    end if;
    if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
      raise exception 'Η σύνδεση χρήστη γίνεται αυτόματα με το email';
    end if;
  end if;
  return new;
end $$;
create trigger trg_member_roles before insert or update on public.gym_members
  for each row execute function public.tg_member_roles();

-- Την κατάσταση (έγκριση) του γυμναστηρίου την αλλάζει μόνο ο διαχειριστής πλατφόρμας
create or replace function public.tg_gym_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_admin()
     and (new.status is distinct from old.status or new.approved_at is distinct from old.approved_at) then
    raise exception 'Η έγκριση γυμναστηρίου γίνεται μόνο από τη διαχείριση';
  end if;
  return new;
end $$;
create trigger trg_gym_status before update on public.gyms
  for each row execute function public.tg_gym_status();

create or replace function public.tg_gym_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into progression_settings (gym_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger trg_gym_defaults after insert on public.gyms
  for each row execute function public.tg_gym_defaults();

-- Αυτόματη σύνδεση νέου χρήστη (auth) με τις εγγραφές μέλους που έχουν το email του
create or replace function public.tg_link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update gym_members set user_id = new.id
  where user_id is null and email = lower(trim(new.email));
  return new;
end $$;
create trigger on_auth_user_created after insert or update of email on auth.users
  for each row execute function public.tg_link_auth_user();

-- ---------- RPC ----------
-- Εγγραφή νέου γυμναστηρίου από τον ιδιοκτήτη (μπαίνει «σε αναμονή έγκρισης»)
create or replace function public.register_gym(p_gym_name text, p_owner_name text,
                                               p_city text default null, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_gym uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'Απαιτείται σύνδεση'; end if;
  if (select count(*) from gyms where created_by = auth.uid() and status = 'pending') >= 2 then
    raise exception 'Υπάρχει ήδη αίτηση σε αναμονή';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into gyms (name, city, phone, created_by)
    values (trim(p_gym_name), p_city, p_phone, auth.uid()) returning id into v_gym;
  perform set_config('app.registering_gym', 'on', true);
  insert into gym_members (gym_id, user_id, email, full_name, phone, is_owner, is_coach)
    values (v_gym, auth.uid(), lower(v_email), trim(p_owner_name), p_phone, true, true);
  perform set_config('app.registering_gym', 'off', true);
  return v_gym;
end $$;

create or replace function public.approve_gym(p_gym uuid, p_active boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Μόνο για τη διαχείριση'; end if;
  update gyms set status = case when p_active then 'active' else 'suspended' end,
                  approved_at = case when p_active then coalesce(approved_at, now()) else approved_at end
  where id = p_gym;
end $$;

-- Οι ρόλοι μου σε όλα τα γυμναστήρια (για την αρχική οθόνη της εφαρμογής)
create or replace function public.my_memberships()
returns table (member_id uuid, gym_id uuid, gym_name text, gym_status text,
               primary_color text, secondary_color text, logo_url text,
               full_name text, is_owner boolean, is_coach boolean, is_athlete boolean)
language sql stable security definer set search_path = public as $$
  select m.id, g.id, g.name, g.status, g.primary_color, g.secondary_color, g.logo_url,
         m.full_name, m.is_owner, m.is_coach, m.is_athlete
  from gym_members m join gyms g on g.id = m.gym_id
  where m.user_id = auth.uid() and m.status = 'active'
  order by g.name
$$;

-- ---------- RLS ----------
alter table public.platform_admins      enable row level security;
alter table public.gyms                 enable row level security;
alter table public.gym_members          enable row level security;
alter table public.exercise_library     enable row level security;
alter table public.equipment            enable row level security;
alter table public.exercises            enable row level security;
alter table public.programs             enable row level security;
alter table public.program_days         enable row level security;
alter table public.program_exercises    enable row level security;
alter table public.workout_sessions     enable row level security;
alter table public.workout_sets         enable row level security;
alter table public.attendance           enable row level security;
alter table public.progression_settings enable row level security;

create policy admins_self on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- gyms
create policy gyms_select on public.gyms for select to authenticated
  using (public.is_platform_admin() or created_by = auth.uid() or public.is_gym_member(id));
create policy gyms_update on public.gyms for update to authenticated
  using (public.is_platform_admin() or public.is_gym_owner(id))
  with check (public.is_platform_admin() or public.is_gym_owner(id));

-- gym_members
create policy members_select on public.gym_members for select to authenticated
  using (public.is_platform_admin() or public.is_gym_staff(gym_id) or user_id = auth.uid()
         or (is_coach and public.is_gym_member(gym_id)));
create policy members_insert on public.gym_members for insert to authenticated
  with check (public.is_gym_staff(gym_id));
create policy members_update on public.gym_members for update to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));
create policy members_delete on public.gym_members for delete to authenticated
  using (public.is_gym_owner(gym_id) and user_id is distinct from auth.uid());

-- βιβλιοθήκη ασκήσεων: όλοι οι συνδεδεμένοι διαβάζουν
create policy library_select on public.exercise_library for select to authenticated using (true);
create policy library_admin on public.exercise_library for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- equipment / exercises / progression_settings: μέλη διαβάζουν, προσωπικό γράφει
create policy equipment_select on public.equipment for select to authenticated using (public.is_gym_member(gym_id));
create policy equipment_write  on public.equipment for all to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));
create policy exercises_select on public.exercises for select to authenticated using (public.is_gym_member(gym_id));
create policy exercises_write  on public.exercises for all to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));
create policy prog_settings_select on public.progression_settings for select to authenticated using (public.is_gym_member(gym_id));
create policy prog_settings_write  on public.progression_settings for update to authenticated
  using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));

-- προγράμματα: προσωπικό τα πάντα, αθλητής μόνο ανάγνωση των δικών του
create policy programs_select on public.programs for select to authenticated using (public.can_view_program(id));
create policy programs_write  on public.programs for all to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));
create policy days_select on public.program_days for select to authenticated using (public.can_view_program(program_id));
create policy days_write  on public.program_days for all to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));
create policy pex_select on public.program_exercises for select to authenticated
  using (public.is_gym_staff(gym_id) or exists (
    select 1 from public.program_days d where d.id = program_day_id and public.can_view_program(d.program_id)));
create policy pex_write on public.program_exercises for all to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));

-- προπονήσεις: προσωπικό ή ο ίδιος ο αθλητής
create policy sessions_all on public.workout_sessions for all to authenticated
  using (public.is_gym_staff(gym_id) or public.is_me(athlete_id))
  with check (public.is_gym_staff(gym_id) or public.is_me(athlete_id));
create policy sets_all on public.workout_sets for all to authenticated
  using (public.can_edit_session(session_id)) with check (public.can_edit_session(session_id));

-- παρουσίες: προσωπικό γράφει, αθλητής βλέπει τις δικές του
create policy attendance_select on public.attendance for select to authenticated
  using (public.is_gym_staff(gym_id) or public.is_me(member_id));
create policy attendance_write on public.attendance for all to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));

-- ---------- Δικαιώματα (δεν εκτίθεται τίποτα στο anon) ----------
grant select on public.platform_admins, public.exercise_library to authenticated;
grant select, update on public.gyms to authenticated;
grant select, insert, update, delete on
  public.gym_members, public.equipment, public.exercises, public.programs, public.program_days,
  public.program_exercises, public.workout_sessions, public.workout_sets, public.attendance
  to authenticated;
grant select, update on public.progression_settings to authenticated;
grant insert, update, delete on public.exercise_library to authenticated; -- φιλτράρεται από RLS (μόνο admin)

revoke execute on all functions in schema public from public, anon;
grant execute on function public.register_gym(text,text,text,text), public.approve_gym(uuid,boolean),
  public.my_memberships(), public.is_platform_admin(), public.is_gym_member(uuid),
  public.is_gym_staff(uuid), public.is_gym_owner(uuid), public.is_me(uuid),
  public.can_view_program(uuid), public.can_edit_session(uuid)
  to authenticated;
