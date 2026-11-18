-- Omnisoft Gym — 6: παραμετροποίηση πλατφόρμας (διαχειριστής), πακέτα/όρια, στατιστικά, σημάνσεις αθλητών

-- ---------- Ρυθμίσεις πλατφόρμας (μία γραμμή) ----------
create table if not exists public.platform_settings (
  id int primary key default 1 check (id = 1),
  allow_gym_signup boolean not null default true,      -- επιτρέπονται νέες αιτήσεις γυμναστηρίων
  default_plan text not null default 'trial',
  default_max_athletes int not null default 30,
  default_trial_days int not null default 30,
  default_primary_color text not null default '#d71920',
  default_secondary_color text not null default '#111111',
  missed_days_hold int not null default 10,
  missed_days_deload int not null default 21,
  deload_pct numeric(4,1) not null default 10,
  max_rpe_for_increase numeric(3,1) not null default 8.5,
  fails_for_decrease int not null default 2,
  decrease_pct numeric(4,1) not null default 5,
  stall_sessions int not null default 4,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (1) on conflict do nothing;
alter table public.platform_settings enable row level security;
create policy ps_select on public.platform_settings for select to authenticated using (true);
create policy ps_update on public.platform_settings for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, update on public.platform_settings to authenticated;

-- ---------- Πακέτο / όρια ανά γυμναστήριο ----------
alter table public.gyms add column if not exists plan text not null default 'trial'
  check (plan in ('trial','basic','pro','free'));
alter table public.gyms add column if not exists max_athletes int not null default 30;
alter table public.gyms add column if not exists paid_until date;
alter table public.gyms add column if not exists admin_notes text;

-- Ο ιδιοκτήτης δεν αλλάζει έγκριση/πακέτο/όρια/σημειώσεις διαχειριστή
create or replace function public.tg_gym_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_admin()
     and (new.status is distinct from old.status or new.approved_at is distinct from old.approved_at
          or new.plan is distinct from old.plan or new.max_athletes is distinct from old.max_athletes
          or new.paid_until is distinct from old.paid_until or new.admin_notes is distinct from old.admin_notes) then
    raise exception 'Αυτά τα στοιχεία αλλάζουν μόνο από τη διαχείριση';
  end if;
  return new;
end $$;

-- Νέο γυμναστήριο: παίρνει τις προεπιλογές της πλατφόρμας
create or replace function public.tg_gym_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
declare d platform_settings%rowtype;
begin
  select * into d from platform_settings where id = 1;
  insert into progression_settings (gym_id, missed_days_hold, missed_days_deload, deload_pct, max_rpe_for_increase,
                                    fails_for_decrease, decrease_pct, stall_sessions)
  values (new.id, d.missed_days_hold, d.missed_days_deload, d.deload_pct, d.max_rpe_for_increase,
          d.fails_for_decrease, d.decrease_pct, d.stall_sessions)
  on conflict do nothing;
  return new;
end $$;

create or replace function public.register_gym(p_gym_name text, p_owner_name text,
                                               p_city text default null, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_gym uuid; v_email text; d platform_settings%rowtype;
begin
  if auth.uid() is null then raise exception 'Απαιτείται σύνδεση'; end if;
  select * into d from platform_settings where id = 1;
  if not d.allow_gym_signup then raise exception 'Οι νέες εγγραφές γυμναστηρίων είναι προσωρινά κλειστές'; end if;
  if (select count(*) from gyms where created_by = auth.uid() and status = 'pending') >= 2 then
    raise exception 'Υπάρχει ήδη αίτηση σε αναμονή';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into gyms (name, city, phone, created_by, plan, max_athletes, paid_until, primary_color, secondary_color)
    values (trim(p_gym_name), p_city, p_phone, auth.uid(), d.default_plan, d.default_max_athletes,
            current_date + d.default_trial_days, d.default_primary_color, d.default_secondary_color)
    returning id into v_gym;
  perform set_config('app.registering_gym', 'on', true);
  insert into gym_members (gym_id, user_id, email, full_name, phone, is_owner, is_coach)
    values (v_gym, auth.uid(), lower(v_email), trim(p_owner_name), p_phone, true, true);
  perform set_config('app.registering_gym', 'off', true);
  return v_gym;
end $$;

-- Όριο αθλητών ανά πακέτο
create or replace function public.tg_max_athletes() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max int; v_cnt int;
begin
  if new.is_athlete and new.status = 'active'
     and (tg_op = 'INSERT' or not old.is_athlete or old.status <> 'active') then
    select max_athletes into v_max from gyms where id = new.gym_id;
    select count(*) into v_cnt from gym_members where gym_id = new.gym_id and is_athlete and status = 'active' and id <> new.id;
    if v_cnt >= v_max then
      raise exception 'Έχετε φτάσει το όριο των % ενεργών αθλητών του πακέτου σας', v_max;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_max_athletes on public.gym_members;
create trigger trg_max_athletes before insert or update on public.gym_members
  for each row execute function public.tg_max_athletes();

-- ---------- Στατιστικά γυμναστηρίων (μόνο διαχειριστής) ----------
create or replace function public.admin_gym_stats()
returns table (gym_id uuid, members int, athletes int, coaches int, linked int, sessions_30d int, last_activity date)
language sql stable security definer set search_path = public as $$
  select g.id,
    (select count(*) from gym_members m where m.gym_id = g.id)::int,
    (select count(*) from gym_members m where m.gym_id = g.id and m.is_athlete and m.status = 'active')::int,
    (select count(*) from gym_members m where m.gym_id = g.id and (m.is_coach or m.is_owner))::int,
    (select count(*) from gym_members m where m.gym_id = g.id and m.user_id is not null)::int,
    (select count(*) from workout_sessions w where w.gym_id = g.id and w.performed_on >= current_date - 30)::int,
    (select max(w.performed_on) from workout_sessions w where w.gym_id = g.id)
  from gyms g where public.is_platform_admin()
$$;

-- ---------- Διαχειριστές πλατφόρμας ----------
create or replace function public.admin_list_admins()
returns table (user_id uuid, email text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.user_id, u.email::text, a.created_at from platform_admins a join auth.users u on u.id = a.user_id
  where public.is_platform_admin() order by u.email
$$;

create or replace function public.admin_add_admin(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.is_platform_admin() then raise exception 'Μόνο για τη διαχείριση'; end if;
  select id into v from auth.users where lower(email) = lower(trim(p_email));
  if v is null then raise exception 'Δεν υπάρχει χρήστης με αυτό το email. Δημιουργήστε πρώτα τον λογαριασμό.'; end if;
  insert into platform_admins (user_id) values (v) on conflict do nothing;
  return lower(trim(p_email));
end $$;

create or replace function public.admin_remove_admin(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Μόνο για τη διαχείριση'; end if;
  if p_user = auth.uid() then raise exception 'Δεν μπορείτε να αφαιρέσετε τον εαυτό σας'; end if;
  delete from platform_admins where user_id = p_user;
end $$;

-- ---------- Βιβλιοθήκη: τύπος κίνησης για το stickman ----------
alter table public.exercise_library add column if not exists motion text;
update public.exercise_library l set motion = v.m from (values
 ('squat_barbell','squat'),('goblet_squat','squat'),('leg_press','legpress'),('leg_extension','legext'),('leg_curl','legcurl'),
 ('lunge_dumbbell','lunge'),('romanian_deadlift','hinge'),('deadlift','hinge'),('hip_thrust','hipthrust'),('calf_raise','calf'),
 ('box_jump','jump'),('lat_pulldown','pulldown'),('seated_row','row'),('db_row','row'),('face_pull','row'),('rowing_machine','row'),
 ('pull_up','pullup'),('bench_press','pressfwd'),('incline_db_press','pressfwd'),('chest_press_machine','pressfwd'),
 ('pec_fly_machine','pressfwd'),('push_up','pushup'),('overhead_press','pressup'),('db_shoulder_press','pressup'),
 ('lateral_raise','lateral'),('biceps_curl','curl'),('triceps_pushdown','pushdown'),('dips','dips'),('plank','plank'),
 ('crunch','crunch'),('russian_twist','twist'),('kettlebell_swing','swing'),('farmer_walk','walk'),('burpee','burpee'),
 ('jump_rope','jump'),('heavy_bag','punch'),('shadow_boxing','punch'),('treadmill','run')) v(c, m)
where l.code = v.c and l.motion is null;

-- ---------- Σημάνσεις αθλητών για τη λίστα του προπονητή ----------
create or replace function public.athlete_flags(p_gym uuid)
returns table (athlete_id uuid, n_increase int, n_stall int, n_decrease int, n_deload int)
language plpgsql stable security invoker set search_path = public as $$
declare m record;
begin
  for m in select id from gym_members where gym_id = p_gym and is_athlete and status = 'active' loop
    athlete_id := m.id;
    select count(*) filter (where s.status = 'increase'), count(*) filter (where s.status = 'stall'),
           count(*) filter (where s.status = 'decrease'), count(*) filter (where s.status = 'deload')
      into n_increase, n_stall, n_decrease, n_deload
    from suggest_progression(m.id) s;
    return next;
  end loop;
end $$;

revoke execute on function public.admin_gym_stats(), public.admin_list_admins(), public.admin_add_admin(text),
  public.admin_remove_admin(uuid), public.athlete_flags(uuid) from public, anon;
grant execute on function public.admin_gym_stats(), public.admin_list_admins(), public.admin_add_admin(text),
  public.admin_remove_admin(uuid), public.athlete_flags(uuid) to authenticated;
revoke execute on function public.tg_max_athletes() from public, anon, authenticated;

update public.gyms set paid_until = current_date + 30 where paid_until is null;
