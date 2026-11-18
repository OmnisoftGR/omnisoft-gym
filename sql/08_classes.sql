-- Omnisoft Gym — 8: τμήματα, διαθεσιμότητες, κρατήσεις (αντί για zcal) + απλές προτάσεις κιλών

-- =====================================================================
-- A. Απλές προτάσεις: ανά άσκηση «αυτόματη αύξηση ναι/όχι», σταθεροί κανόνες
-- =====================================================================
alter table public.program_exercises add column if not exists auto_progress boolean not null default true;

create or replace function public.suggest_progression(p_athlete uuid)
returns table (program_exercise_id uuid, program_day text, exercise_name text, sets int,
               reps_min int, reps_max int, last_date date, last_weight numeric, last_reps text,
               suggested_weight numeric, status text, reason text)
language plpgsql stable security invoker set search_path = public as $$
declare
  r record; v_last date; v_w numeric; v_allmax boolean; v_nsets int; v_fails int; v_days int;
begin
  for r in
    select pe.*, d.name as day_name, e.name as ex_name, e.metric_type,
           coalesce(nullif(pe.increment_kg, 0), nullif(e.increment_kg, 0), 2.5) as inc
    from programs pr
    join program_days d on d.program_id = pr.id
    join program_exercises pe on pe.program_day_id = d.id
    join exercises e on e.id = pe.exercise_id
    where pr.athlete_id = p_athlete and pr.active
    order by d.day_no, pe.sort_order
  loop
    program_exercise_id := r.id; program_day := r.day_name; exercise_name := r.ex_name;
    sets := r.sets; reps_min := r.reps_min; reps_max := r.reps_max;

    select ws.performed_on into v_last
    from workout_sessions ws join workout_sets s on s.session_id = ws.id
    where ws.athlete_id = p_athlete and s.exercise_id = r.exercise_id
    order by ws.performed_on desc limit 1;
    last_date := v_last;

    if v_last is not null then
      select max(s.weight), bool_and(s.reps >= coalesce(r.reps_max, r.reps_min, 0)), count(*),
             string_agg(coalesce(s.reps::text, s.seconds || '″'), '-' order by s.set_no)
        into v_w, v_allmax, v_nsets, last_reps
      from workout_sessions ws join workout_sets s on s.session_id = ws.id
      where ws.athlete_id = p_athlete and s.exercise_id = r.exercise_id and ws.performed_on = v_last;
    else
      v_w := null; last_reps := null;
    end if;
    last_weight := v_w;

    -- Ασκήσεις χρόνου / χωρίς κιλά / σταθερά κιλά: μόνο ο στόχος του προγράμματος
    if r.metric_type = 'time' or (v_w is null and r.target_weight is null) then
      suggested_weight := r.target_weight; status := case when v_last is null then 'new' else 'hold' end;
      reason := case when r.metric_type = 'time' then 'Στόχος χρόνου του προγράμματος' else 'Όπως στο πρόγραμμα' end;
    elsif not r.auto_progress then
      suggested_weight := coalesce(r.target_weight, v_w); status := 'fixed';
      reason := 'Σταθερά κιλά από τον προπονητή';
    elsif v_last is null then
      suggested_weight := r.target_weight; status := 'new';
      reason := 'Πρώτη φορά: κιλά του προγράμματος';
    else
      v_days := current_date - v_last;
      select count(*) into v_fails from (
        select x.failed, sum(case when x.failed then 0 else 1 end) over (order by x.d desc) as grp
        from (select ws.performed_on d, min(s.reps) < coalesce(r.reps_min, 0) as failed
              from workout_sessions ws join workout_sets s on s.session_id = ws.id
              where ws.athlete_id = p_athlete and s.exercise_id = r.exercise_id
              group by ws.performed_on) x) y where y.grp = 0;

      if v_days > 21 then
        suggested_weight := (round(v_w * 0.9 / r.inc) * r.inc)::numeric(6,1); status := 'deload';
        reason := format('Απουσία %s ημερών: λίγο πιο ελαφριά', v_days);
      elsif v_days > 10 then
        suggested_weight := v_w; status := 'hold'; reason := 'Μετά από διάλειμμα: ίδια κιλά';
      elsif v_fails >= 2 then
        suggested_weight := greatest(v_w - r.inc, 0); status := 'decrease';
        reason := format('Δύο φορές κάτω από %s επαναλήψεις: −%s κ.', r.reps_min, r.inc::float);
      elsif v_allmax and v_nsets >= r.sets then
        suggested_weight := v_w + r.inc; status := 'increase';
        reason := format('Έβγαλες όλα τα σετ: +%s κ.', r.inc::float);
      else
        suggested_weight := v_w; status := 'hold'; reason := 'Ίδια κιλά, +1 επανάληψη';
      end if;
    end if;
    return next;
  end loop;
end $$;

-- =====================================================================
-- B. Τμήματα και κρατήσεις
-- =====================================================================
alter table public.gyms add column if not exists cancel_hours int not null default 2;
alter table public.gyms add column if not exists booking_requires_sub boolean not null default true;
alter table public.gyms add column if not exists book_ahead_days int not null default 14;

alter table public.attendance drop constraint if exists attendance_method_check;
alter table public.attendance add constraint attendance_method_check
  check (method in ('manual','rfid','qr','nfc','workout','class'));

-- Είδη: ομαδικό τμήμα ή personal (1-1)
create table if not exists public.class_types (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null,
  kind text not null default 'group' check (kind in ('group','personal')),
  capacity int not null default 12 check (capacity > 0),
  duration_min int not null default 60 check (duration_min between 10 and 240),
  coach_id uuid references public.gym_members(id) on delete set null,
  color text not null default '#d71920',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Εβδομαδιαίο πρόγραμμα. Ομαδικό: μία ώρα έναρξης. Personal: παράθυρο διαθεσιμότητας που σπάει σε slots.
create table if not exists public.class_slots (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  class_type_id uuid not null references public.class_types(id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),       -- 1 = Δευτέρα
  start_time time not null,
  end_time time,                                              -- μόνο για personal
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  class_type_id uuid not null references public.class_types(id) on delete cascade,
  slot_id uuid references public.class_slots(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null,
  cancelled boolean not null default false,
  unique (class_type_id, starts_at)
);
create index if not exists class_sessions_gym_start on public.class_sessions (gym_id, starts_at);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  status text not null default 'booked' check (status in ('booked','waitlist','cancelled','attended','no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, member_id)
);
create index if not exists bookings_member on public.bookings (member_id);

-- gym_id από τον γονικό πίνακα
create or replace function public.tg_gym_from_class_type() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select gym_id into new.gym_id from class_types where id = new.class_type_id;
  return new;
end $$;
drop trigger if exists trg_a_gym on public.class_slots;
create trigger trg_a_gym before insert or update on public.class_slots for each row execute function public.tg_gym_from_class_type();

-- Δημιουργία συνεδριών από το εβδομαδιαίο πρόγραμμα (εσωτερική, χωρίς έλεγχο δικαιωμάτων)
create or replace function public._gen_sessions(p_gym uuid, p_from date, p_to date) returns void
language plpgsql security definer set search_path = public as $$
declare d date; s record; t time; v_end time;
begin
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    for s in select sl.*, ct.kind, ct.capacity, ct.duration_min
             from class_slots sl join class_types ct on ct.id = sl.class_type_id
             where sl.gym_id = p_gym and sl.active and ct.active and sl.weekday = extract(isodow from d)
    loop
      if s.kind = 'group' then
        insert into class_sessions (gym_id, class_type_id, slot_id, starts_at, ends_at, capacity)
        values (p_gym, s.class_type_id, s.id, (d + s.start_time) at time zone 'Europe/Athens',
                (d + s.start_time + make_interval(mins => s.duration_min)) at time zone 'Europe/Athens', s.capacity)
        on conflict do nothing;
      else
        t := s.start_time; v_end := coalesce(s.end_time, s.start_time + make_interval(mins => s.duration_min));
        while t + make_interval(mins => s.duration_min) <= v_end and t >= s.start_time loop
          insert into class_sessions (gym_id, class_type_id, slot_id, starts_at, ends_at, capacity)
          values (p_gym, s.class_type_id, s.id, (d + t) at time zone 'Europe/Athens',
                  (d + t + make_interval(mins => s.duration_min)) at time zone 'Europe/Athens', 1)
          on conflict do nothing;
          t := t + make_interval(mins => s.duration_min);
        end loop;
      end if;
    end loop;
  end loop;
end $$;

-- Συνεδρίες περιόδου με πληρότητα και την κατάσταση του χρήστη
create or replace function public.sessions_for(p_gym uuid, p_from date, p_to date)
returns table (session_id uuid, starts_at timestamptz, ends_at timestamptz, class_type_id uuid, name text,
               kind text, color text, coach_name text, capacity int, booked int, waitlist int,
               cancelled boolean, my_status text, my_booking uuid)
language plpgsql security definer set search_path = public as $$
declare v_me uuid;
begin
  if not public.is_gym_member(p_gym) then raise exception 'Χωρίς πρόσβαση'; end if;
  if p_to - p_from > 62 then raise exception 'Πολύ μεγάλο διάστημα'; end if;
  perform public._gen_sessions(p_gym, greatest(p_from, current_date), p_to);
  select id into v_me from gym_members where gym_id = p_gym and user_id = auth.uid() limit 1;
  return query
  select cs.id, cs.starts_at, cs.ends_at, ct.id, ct.name, ct.kind, ct.color, co.full_name, cs.capacity,
         (select count(*)::int from bookings b where b.session_id = cs.id and b.status in ('booked','attended')),
         (select count(*)::int from bookings b where b.session_id = cs.id and b.status = 'waitlist'),
         cs.cancelled, mb.status, mb.id
  from class_sessions cs
  join class_types ct on ct.id = cs.class_type_id
  left join gym_members co on co.id = ct.coach_id
  left join bookings mb on mb.session_id = cs.id and mb.member_id = v_me and mb.status <> 'cancelled'
  where cs.gym_id = p_gym
    and cs.starts_at >= (p_from::timestamp at time zone 'Europe/Athens')
    and cs.starts_at <  ((p_to + 1)::timestamp at time zone 'Europe/Athens')
  order by cs.starts_at, ct.name;
end $$;

-- Κράτηση θέσης (ο ίδιος ο αθλητής, ή το προσωπικό για κάποιο μέλος)
create or replace function public.book_session(p_session uuid, p_member uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare s class_sessions%rowtype; g gyms%rowtype; v_member uuid; v_staff boolean; v_taken int; v_status text; v_id uuid;
begin
  select * into s from class_sessions where id = p_session;
  if s.id is null or s.cancelled then raise exception 'Η ώρα δεν είναι διαθέσιμη'; end if;
  select * into g from gyms where id = s.gym_id;
  v_staff := public.is_gym_staff(s.gym_id);
  if p_member is not null and v_staff then
    v_member := p_member;
  else
    select id into v_member from gym_members where gym_id = s.gym_id and user_id = auth.uid() and status = 'active' limit 1;
  end if;
  if v_member is null then raise exception 'Χωρίς πρόσβαση'; end if;
  if not v_staff then
    if s.starts_at < now() then raise exception 'Η ώρα έχει περάσει'; end if;
    if s.starts_at > now() + make_interval(days => g.book_ahead_days + 1) then
      raise exception 'Κρατήσεις έως % ημέρες μπροστά', g.book_ahead_days; end if;
    if g.booking_requires_sub and public.valid_membership(v_member, (s.starts_at at time zone 'Europe/Athens')::date) is null then
      raise exception 'Χρειάζεται ενεργή συνδρομή για κράτηση'; end if;
  end if;
  perform 1 from class_sessions where id = p_session for update;
  select count(*) into v_taken from bookings where session_id = p_session and status in ('booked','attended') and member_id <> v_member;
  v_status := case when v_taken < s.capacity then 'booked' else 'waitlist' end;
  insert into bookings (gym_id, session_id, member_id, status)
  values (s.gym_id, p_session, v_member, v_status)
  on conflict (session_id, member_id) do update
    set status = case when bookings.status in ('booked','attended','waitlist') then bookings.status else excluded.status end,
        updated_at = now()
  returning id, status into v_id, v_status;
  return json_build_object('booking_id', v_id, 'status', v_status);
end $$;

-- Ακύρωση (ο αθλητής έως Χ ώρες πριν· το προσωπικό πάντα). Η πρώτη θέση αναμονής προωθείται.
create or replace function public.cancel_booking(p_booking uuid)
returns json language plpgsql security definer set search_path = public as $$
declare b bookings%rowtype; s class_sessions%rowtype; v_hours int; v_next uuid;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'Δεν βρέθηκε η κράτηση'; end if;
  select * into s from class_sessions where id = b.session_id;
  if not public.is_gym_staff(b.gym_id) then
    if not public.is_me(b.member_id) then raise exception 'Χωρίς πρόσβαση'; end if;
    select cancel_hours into v_hours from gyms where id = b.gym_id;
    if b.status = 'booked' and s.starts_at - now() < make_interval(hours => v_hours) then
      raise exception 'Η ακύρωση γίνεται έως % ώρες πριν', v_hours; end if;
  end if;
  update bookings set status = 'cancelled', updated_at = now() where id = b.id;
  if b.status = 'booked' then
    select id into v_next from bookings where session_id = b.session_id and status = 'waitlist' order by created_at limit 1;
    if v_next is not null then update bookings set status = 'booked', updated_at = now() where id = v_next; end if;
  end if;
  return json_build_object('ok', true, 'promoted', v_next);
end $$;

-- Παρουσία σε τμήμα από το προσωπικό (✓ / αναίρεση)
create or replace function public.mark_booking(p_booking uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare b bookings%rowtype;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null or not public.is_gym_staff(b.gym_id) then raise exception 'Χωρίς πρόσβαση'; end if;
  if p_status not in ('booked','attended','no_show') then raise exception 'Άκυρη κατάσταση'; end if;
  update bookings set status = p_status, updated_at = now() where id = b.id;
  if p_status = 'attended' and not exists (
       select 1 from attendance where member_id = b.member_id and checked_in_at::date = current_date) then
    insert into attendance (gym_id, member_id, method) values (b.gym_id, b.member_id, 'class');
  end if;
end $$;

-- Με κάθε check-in, η σημερινή κράτηση του μέλους γίνεται «ήρθε»
create or replace function public.tg_attendance_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update bookings b set status = 'attended', updated_at = now()
  from class_sessions s
  where b.session_id = s.id and b.member_id = new.member_id and b.status = 'booked'
    and (s.starts_at at time zone 'Europe/Athens')::date = (new.checked_in_at at time zone 'Europe/Athens')::date;
  return new;
end $$;
drop trigger if exists trg_c_booking on public.attendance;
create trigger trg_c_booking after insert on public.attendance for each row execute function public.tg_attendance_booking();

-- check-in: δέχεται και τους τρόπους nfc / class
create or replace function public.checkin(p_gym uuid, p_code text, p_method text default 'qr')
returns json language plpgsql security definer set search_path = public as $$
declare v_code text; m gym_members%rowtype; v_already boolean; s record;
begin
  if not public.is_gym_staff(p_gym) then raise exception 'Μόνο για το προσωπικό'; end if;
  v_code := regexp_replace(trim(coalesce(p_code, '')), '^OGYM:', '', 'i');
  select * into m from gym_members
  where gym_id = p_gym and status = 'active'
    and (checkin_code = v_code or id::text = v_code
         or upper(regexp_replace(rfid_tag, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(v_code, '[^A-Za-z0-9]', '', 'g')))
  limit 1;
  if m.id is null then raise exception 'Άγνωστος κωδικός ή κάρτα'; end if;
  v_already := exists (select 1 from attendance where member_id = m.id and checked_in_at::date = current_date);
  if not v_already then
    insert into attendance (gym_id, member_id, method)
    values (p_gym, m.id, case when p_method in ('qr','rfid','nfc','manual','class') then p_method else 'rfid' end);
  end if;
  select * into s from public.sub_status(p_gym) x where x.member_id = m.id;
  return json_build_object('member_id', m.id, 'name', m.full_name, 'already', v_already, 'is_athlete', m.is_athlete,
    'status', coalesce(s.status, 'none'), 'plan', s.plan_name, 'end_date', s.end_date, 'visits_left', s.visits_left);
end $$;

-- ---------- RLS ----------
alter table public.class_types enable row level security;
alter table public.class_slots enable row level security;
alter table public.class_sessions enable row level security;
alter table public.bookings enable row level security;

create policy class_types_select on public.class_types for select to authenticated using (public.is_gym_member(gym_id));
create policy class_types_write on public.class_types for all to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));
create policy class_slots_select on public.class_slots for select to authenticated using (public.is_gym_member(gym_id));
create policy class_slots_write on public.class_slots for all to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));
create policy class_sessions_select on public.class_sessions for select to authenticated using (public.is_gym_member(gym_id));
create policy class_sessions_update on public.class_sessions for update to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));
create policy bookings_select on public.bookings for select to authenticated
  using (public.is_gym_staff(gym_id) or public.is_me(member_id));

grant select, insert, update, delete on public.class_types, public.class_slots to authenticated;
grant select, update on public.class_sessions to authenticated;
grant select on public.bookings to authenticated;

revoke execute on function public._gen_sessions(uuid, date, date), public.tg_gym_from_class_type(),
  public.tg_attendance_booking() from public, anon, authenticated;
revoke execute on function public.sessions_for(uuid, date, date), public.book_session(uuid, uuid),
  public.cancel_booking(uuid), public.mark_booking(uuid, text), public.checkin(uuid, text, text) from public, anon;
grant execute on function public.sessions_for(uuid, date, date), public.book_session(uuid, uuid),
  public.cancel_booking(uuid), public.mark_booking(uuid, text), public.checkin(uuid, text, text) to authenticated;

-- ---------- Demo δεδομένα ----------
do $$
declare g uuid; c uuid; kb uuid; fn uuid; pt uuid; m record; s uuid; i int := 0;
begin
  select id into g from gyms where name in ('Demo Fight Club', 'Fit or Fight') order by name limit 1;
  if g is null or exists (select 1 from class_types where gym_id = g) then return; end if;
  select id into c from gym_members where gym_id = g and is_coach order by is_owner desc limit 1;
  insert into class_types (gym_id, name, kind, capacity, duration_min, coach_id, color)
    values (g, 'Kickboxing', 'group', 12, 60, c, '#d71920') returning id into kb;
  insert into class_types (gym_id, name, kind, capacity, duration_min, coach_id, color)
    values (g, 'Functional', 'group', 10, 45, c, '#1f6feb') returning id into fn;
  insert into class_types (gym_id, name, kind, capacity, duration_min, coach_id, color)
    values (g, 'Personal 1-1', 'personal', 1, 60, c, '#2da44e') returning id into pt;
  insert into class_slots (class_type_id, weekday, start_time)
    select kb, d, t from unnest(array[1,3,5]) d, unnest(array['18:00'::time, '19:00'::time]) t;
  insert into class_slots (class_type_id, weekday, start_time)
    select fn, d, t from unnest(array[2,4]) d, unnest(array['09:00'::time, '19:00'::time]) t;
  insert into class_slots (class_type_id, weekday, start_time) values (fn, 6, '10:00');
  insert into class_slots (class_type_id, weekday, start_time, end_time)
    select pt, d, '10:00', '13:00' from generate_series(1,5) d;
  perform public._gen_sessions(g, current_date, current_date + 7);
  -- κρατήσεις των demo αθλητών στα επόμενα kickboxing
  for s in select id from class_sessions where class_type_id = kb and starts_at > now() order by starts_at limit 3 loop
    for m in select id from gym_members where gym_id = g and is_athlete and status = 'active' loop
      i := i + 1;
      if i % 3 <> 0 then insert into bookings (gym_id, session_id, member_id) values (g, s, m.id) on conflict do nothing; end if;
    end loop;
  end loop;
end $$;

-- =====================================================================
-- C. Πρόγραμμα με σύνολο προπονήσεων (όχι ανά εβδομάδα): οι χαμένες μέρες δεν «καίνε» πρόγραμμα
-- =====================================================================
alter table public.programs add column if not exists total_sessions int not null default 12
  check (total_sessions between 1 and 200);
update public.programs set total_sessions = least(200, sessions_per_week * 4) where total_sessions = 12 and sessions_per_week <> 3;

create or replace view public.v_athlete_status with (security_invoker = true) as
select m.gym_id, m.id as athlete_id, m.full_name, m.coach_id,
       ls.last_workout,
       la.last_checkin::date as last_checkin,
       current_date - greatest(ls.last_workout, la.last_checkin::date) as days_absent,
       (select count(*) from public.workout_sessions w
         where w.athlete_id = m.id and w.performed_on >= current_date - 28) as workouts_28d,
       (select p.sessions_per_week * 4 from public.programs p
         where p.athlete_id = m.id and p.active order by p.start_date desc limit 1) as planned_28d,
       ap.total_sessions as program_total,
       (select count(*) from public.workout_sessions w join public.program_days d on d.id = w.program_day_id
         where w.athlete_id = m.id and d.program_id = ap.id) as program_done
from public.gym_members m
left join lateral (select max(performed_on) as last_workout from public.workout_sessions w where w.athlete_id = m.id) ls on true
left join lateral (select max(checked_in_at) as last_checkin from public.attendance a where a.member_id = m.id) la on true
left join lateral (select p.id, p.total_sessions from public.programs p
                   where p.athlete_id = m.id and p.active order by p.start_date desc limit 1) ap on true
where m.is_athlete and m.status = 'active';
grant select on public.v_athlete_status to authenticated;
-- demo: τα υπάρχοντα προγράμματα να μην εμφανίζονται ήδη τελειωμένα
update public.programs p set total_sessions = greatest(12, x.done + 6)
from (select d.program_id, count(*) done from public.workout_sessions w join public.program_days d on d.id = w.program_day_id group by 1) x
where x.program_id = p.id and p.active and x.done >= p.total_sessions;
-- χωρίς διαλείμματα στα προγράμματα
alter table public.program_exercises alter column rest_seconds drop default;
update public.program_exercises set rest_seconds = null;
