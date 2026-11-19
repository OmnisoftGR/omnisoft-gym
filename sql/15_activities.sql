-- Omnisoft Gym — 15: Δραστηριότητες (Kick box, Pilates, Gym, Personal …)
-- * Κάθε δραστηριότητα (class_types) έχει ή δεν έχει πρόγραμμα ασκήσεων (has_program).
--   Χωρίς πρόγραμμα: η παρουσία / η κράτηση που τσεκάρεται μετράει ως προπόνηση.
-- * Τα προγράμματα (και τα πρότυπα) ανήκουν σε δραστηριότητα. Η εναλλαγή γίνεται ανά δραστηριότητα.
-- * Η παρουσία είναι ανά δραστηριότητα (gym το πρωί + kick box το απόγευμα = 2 παρουσίες).
-- * Τα πακέτα καλύπτουν συγκεκριμένες δραστηριότητες (κενό = όλες) και προαιρετικά όριο φορών/εβδομάδα.
--   Η συνδρομή κρατά αντίγραφο από το πακέτο τη στιγμή της πώλησης.

alter table public.class_types add column if not exists has_program boolean not null default false;
alter table public.programs add column if not exists class_type_id uuid references public.class_types(id) on delete set null;
alter table public.attendance add column if not exists class_type_id uuid references public.class_types(id) on delete set null;
alter table public.membership_plans add column if not exists activity_ids uuid[];
alter table public.membership_plans add column if not exists weekly_limit int check (weekly_limit between 1 and 14);
alter table public.memberships add column if not exists activity_ids uuid[];
alter table public.memberships add column if not exists weekly_limit int check (weekly_limit between 1 and 14);

-- Τοπική ημερομηνία (Ελλάδα)
create or replace function public.local_day(t timestamptz) returns date
language sql immutable as $$ select (t at time zone 'Europe/Athens')::date $$;

-- Καλύπτει η λίστα δραστηριοτήτων τη δραστηριότητα; (κενή λίστα ή άγνωστη δραστηριότητα = ναι)
create or replace function public.covers(p_ids uuid[], p_ct uuid) returns boolean
language sql immutable as $$ select p_ids is null or cardinality(p_ids) = 0 or p_ct is null or p_ct = any(p_ids) $$;

-- Ισχύουσα συνδρομή που καλύπτει τη δραστηριότητα (πρώτα οι ειδικές, μετά τα πακέτα επισκέψεων)
create or replace function public.valid_membership_for(p_member uuid, p_day date, p_ct uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from memberships
  where member_id = p_member and status = 'active' and start_date <= p_day
    and (end_date is null or end_date >= p_day)
    and (kind = 'time' or visits_used < visits_total)
    and public.covers(activity_ids, p_ct)
  order by (activity_ids is not null and cardinality(activity_ids) > 0) desc, (kind = 'visits') desc, coalesce(end_date, '9999-12-31') asc
  limit 1
$$;

-- Πόσες φορές χρησιμοποιήθηκε η συνδρομή την εβδομάδα (Δευ–Κυρ) της ημέρας:
-- παρουσίες σε δραστηριότητες που καλύπτει + κρατήσεις που δεν έχουν γίνει ακόμα παρουσία
create or replace function public.week_used(p_member uuid, p_ms uuid, p_day date, p_skip_session uuid default null)
returns int language sql stable security definer set search_path = public as $$
  with ms as (select activity_ids from memberships where id = p_ms),
       w as (select date_trunc('week', p_day::timestamp)::date as d0)
  select (
    (select count(*) from attendance a, ms, w
      where a.member_id = p_member and public.local_day(a.checked_in_at) between w.d0 and w.d0 + 6
        and public.covers(ms.activity_ids, a.class_type_id))
  + (select count(*) from bookings b join class_sessions s on s.id = b.session_id, ms, w
      where b.member_id = p_member and b.status = 'booked' and b.session_id is distinct from p_skip_session
        and public.local_day(s.starts_at) between w.d0 and w.d0 + 6
        and public.covers(ms.activity_ids, s.class_type_id)
        and not exists (select 1 from attendance a where a.member_id = p_member and a.class_type_id = s.class_type_id
                          and public.local_day(a.checked_in_at) = public.local_day(s.starts_at))))::int
$$;

-- ---------- Κράτηση: η συνδρομή πρέπει να καλύπτει τη δραστηριότητα και να μην έχει φτάσει το όριο εβδομάδας ----------
create or replace function public.book_session(p_session uuid, p_member uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare s class_sessions%rowtype; g gyms%rowtype; ct class_types%rowtype; v_member uuid; v_staff boolean; v_taken int;
        v_status text; v_id uuid; v_day date; v_ms uuid; v_lim int;
begin
  select * into s from class_sessions where id = p_session;
  if s.id is null or s.cancelled then raise exception 'Η ώρα δεν είναι διαθέσιμη'; end if;
  select * into g from gyms where id = s.gym_id;
  select * into ct from class_types where id = s.class_type_id;
  v_staff := public.is_gym_staff(s.gym_id);
  if p_member is not null and v_staff then
    v_member := p_member;
  else
    select id into v_member from gym_members where gym_id = s.gym_id and user_id = auth.uid() and status = 'active' limit 1;
  end if;
  if v_member is null then raise exception 'Χωρίς πρόσβαση'; end if;
  if not v_staff then
    v_day := public.local_day(s.starts_at);
    if s.starts_at < now() then raise exception 'Η ώρα έχει περάσει'; end if;
    if s.starts_at > now() + make_interval(days => g.book_ahead_days + 1) then
      raise exception 'Κρατήσεις έως % ημέρες μπροστά', g.book_ahead_days; end if;
    if g.booking_requires_sub then
      v_ms := public.valid_membership_for(v_member, v_day, s.class_type_id);
      if v_ms is null then
        if public.valid_membership(v_member, v_day) is not null then
          raise exception 'Η συνδρομή σας δεν καλύπτει: %', ct.name; end if;
        raise exception 'Χρειάζεται ενεργή συνδρομή για κράτηση';
      end if;
      select weekly_limit into v_lim from memberships where id = v_ms;
      if v_lim is not null and public.week_used(v_member, v_ms, v_day, p_session) >= v_lim then
        raise exception 'Έχετε κλείσει ήδη % φορές αυτή την εβδομάδα (όριο πακέτου)', v_lim; end if;
    end if;
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

-- ---------- Παρουσία ανά δραστηριότητα ----------
drop function if exists public.checkin(uuid, text, text);
create or replace function public.checkin(p_gym uuid, p_code text, p_method text default 'manual', p_class_type uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_code text; m gym_members%rowtype; v_already boolean; s record; v_ms uuid; v_lim int; v_used int; v_ct text;
begin
  if not public.is_gym_staff(p_gym) then raise exception 'Μόνο για το προσωπικό'; end if;
  v_code := regexp_replace(trim(coalesce(p_code, '')), '^OGYM:', '', 'i');
  select * into m from gym_members
  where gym_id = p_gym and status = 'active'
    and (checkin_code = v_code or id::text = v_code
         or upper(regexp_replace(rfid_tag, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(v_code, '[^A-Za-z0-9]', '', 'g')))
  limit 1;
  if m.id is null then raise exception 'Άγνωστος κωδικός ή κάρτα'; end if;
  if p_class_type is not null and not exists (select 1 from class_types where id = p_class_type and gym_id = p_gym) then
    raise exception 'Άγνωστη δραστηριότητα'; end if;
  v_already := exists (select 1 from attendance where member_id = m.id and public.local_day(checked_in_at) = public.local_day(now())
                         and class_type_id is not distinct from p_class_type);
  if not v_already then
    insert into attendance (gym_id, member_id, method, class_type_id)
    values (p_gym, m.id, case when p_method in ('qr','rfid','nfc','manual','class') then p_method else 'manual' end, p_class_type);
  end if;
  select * into s from public.sub_status(p_gym) x where x.member_id = m.id;
  v_ms := public.valid_membership_for(m.id, public.local_day(now()), p_class_type);
  if v_ms is not null then
    select weekly_limit into v_lim from memberships where id = v_ms;
    if v_lim is not null then v_used := public.week_used(m.id, v_ms, public.local_day(now())); end if;
  end if;
  select name into v_ct from class_types where id = p_class_type;
  return json_build_object('member_id', m.id, 'name', m.full_name, 'already', v_already, 'is_athlete', m.is_athlete,
    'status', coalesce(s.status, 'none'), 'plan', s.plan_name, 'end_date', s.end_date, 'visits_left', s.visits_left,
    'covers', v_ms is not null or coalesce(s.status, 'none') in ('none', 'expired', 'frozen'),
    'activity', v_ct, 'weekly_limit', v_lim, 'week_used', v_used);
end $$;
revoke execute on function public.checkin(uuid, text, text, uuid) from public, anon;
grant execute on function public.checkin(uuid, text, text, uuid) to authenticated;

-- Τσεκάρισμα κράτησης: παρουσία στη δραστηριότητα του τμήματος
create or replace function public.mark_booking(p_booking uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare b bookings%rowtype; s class_sessions%rowtype;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null or not public.is_gym_staff(b.gym_id) then raise exception 'Χωρίς πρόσβαση'; end if;
  if p_status not in ('booked','attended','no_show') then raise exception 'Άκυρη κατάσταση'; end if;
  select * into s from class_sessions where id = b.session_id;
  update bookings set status = p_status, updated_at = now() where id = b.id;
  if p_status = 'attended' and not exists (
       select 1 from attendance where member_id = b.member_id and class_type_id = s.class_type_id
         and public.local_day(checked_in_at) = public.local_day(s.starts_at)) then
    insert into attendance (gym_id, member_id, method, class_type_id, checked_in_at)
    values (b.gym_id, b.member_id, 'class', s.class_type_id, case when public.local_day(s.starts_at) = public.local_day(now()) then now() else s.starts_at end);
  end if;
end $$;

-- Παρουσία → η κράτηση της ίδιας δραστηριότητας την ίδια μέρα γίνεται «ήρθε»
create or replace function public.tg_attendance_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update bookings b set status = 'attended', updated_at = now()
  from class_sessions s
  where b.session_id = s.id and b.member_id = new.member_id and b.status = 'booked'
    and (new.class_type_id is null or s.class_type_id = new.class_type_id)
    and public.local_day(s.starts_at) = public.local_day(new.checked_in_at);
  return new;
end $$;

-- Πακέτο επισκέψεων: χρεώνεται μόνο αν καλύπτει τη δραστηριότητα
create or replace function public.tg_attendance_visit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if tg_op = 'INSERT' then
    select id into v from memberships
    where member_id = new.member_id and status = 'active' and kind = 'visits' and visits_used < visits_total
      and start_date <= public.local_day(new.checked_in_at) and (end_date is null or end_date >= public.local_day(new.checked_in_at))
      and public.covers(activity_ids, new.class_type_id)
    order by (activity_ids is not null and cardinality(activity_ids) > 0) desc, coalesce(end_date, '9999-12-31'), start_date limit 1;
    if v is not null then
      update memberships set visits_used = visits_used + 1 where id = v;
      new.membership_id := v;
    end if;
    return new;
  else
    if old.membership_id is not null then
      update memberships set visits_used = greatest(0, visits_used - 1) where id = old.membership_id;
    end if;
    return old;
  end if;
end $$;

-- Καταγραφή προπόνησης → παρουσία στη δραστηριότητα του προγράμματος
create or replace function public.tg_session_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ct uuid;
begin
  select pr.class_type_id into v_ct from program_days d join programs pr on pr.id = d.program_id where d.id = new.program_day_id;
  if not exists (select 1 from attendance a
                 where a.member_id = new.athlete_id and public.local_day(a.checked_in_at) = new.performed_on
                   and (a.class_type_id is not distinct from v_ct or a.class_type_id is null)) then
    insert into attendance (gym_id, member_id, checked_in_at, method, class_type_id)
    values (new.gym_id, new.athlete_id,
            case when new.performed_on = public.local_day(now()) then now() else (new.performed_on + time '12:00') at time zone 'Europe/Athens' end,
            'workout', v_ct);
  end if;
  return new;
end $$;

-- Νέα συνδρομή: αντίγραφο δραστηριοτήτων και ορίου από το πακέτο
create or replace function public.new_membership(p_member uuid, p_plan uuid, p_start date default null,
  p_price numeric default null, p_paid numeric default 0, p_method text default 'cash', p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare pl membership_plans%rowtype; mem gym_members%rowtype; v_start date; v_end date; v_id uuid; v_last date;
begin
  select * into mem from gym_members where id = p_member;
  select * into pl from membership_plans where id = p_plan and gym_id = mem.gym_id;
  if pl.id is null or not public.is_gym_owner(mem.gym_id) then raise exception 'Μόνο ο ιδιοκτήτης'; end if;
  -- ανανέωση: ξεκινά μετά τη λήξη της τρέχουσας συνδρομής του ίδιου είδους και των ίδιων δραστηριοτήτων
  select max(end_date) into v_last from memberships where member_id = p_member and status = 'active' and kind = pl.kind
    and coalesce(activity_ids, '{}') = coalesce(pl.activity_ids, '{}');
  v_start := coalesce(p_start, greatest(current_date, coalesce(v_last + 1, current_date)));
  v_end := case when pl.kind = 'time' then (v_start + make_interval(months => pl.months))::date - 1
                when pl.valid_days is not null then v_start + pl.valid_days - 1 end;
  insert into memberships (gym_id, member_id, plan_id, plan_name, kind, start_date, end_date, visits_total, price, notes, activity_ids, weekly_limit)
  values (mem.gym_id, p_member, pl.id, pl.name, pl.kind, v_start, v_end, pl.visits, coalesce(p_price, pl.price), p_notes,
          nullif(pl.activity_ids, '{}'), pl.weekly_limit)
  returning id into v_id;
  if coalesce(p_paid, 0) > 0 then
    insert into payments (gym_id, member_id, membership_id, amount, method) values (mem.gym_id, p_member, v_id, p_paid, p_method);
  end if;
  return v_id;
end $$;

-- Μεμονωμένη προπόνηση: ισχύει μόνο για τη δραστηριότητά της
create or replace function public.dropin(p_member uuid, p_class_type uuid, p_paid boolean, p_method text default 'cash')
returns json language plpgsql security definer set search_path = public as $$
declare m gym_members%rowtype; t class_types%rowtype; v_ms uuid; v_att uuid;
begin
  select * into m from gym_members where id = p_member;
  if m.id is null or not public.is_gym_staff(m.gym_id) then raise exception 'Χωρίς πρόσβαση'; end if;
  select * into t from class_types where id = p_class_type and gym_id = m.gym_id;
  if t.id is null then raise exception 'Άγνωστη δραστηριότητα'; end if;
  if t.dropin_price is null then raise exception 'Δεν έχει οριστεί τιμή μεμονωμένης για το %', t.name; end if;
  insert into memberships (gym_id, member_id, plan_name, kind, start_date, end_date, visits_total, price, notes, activity_ids)
  values (m.gym_id, m.id, 'Μεμονωμένη · ' || t.name, 'visits', current_date, current_date, 1, t.dropin_price, 'Μεμονωμένη προπόνηση', array[t.id])
  returning id into v_ms;
  if p_paid and t.dropin_price > 0 then
    insert into payments (gym_id, member_id, membership_id, amount, method, notes)
    values (m.gym_id, m.id, v_ms, t.dropin_price, case when p_method in ('cash','card','iris','bank','other') then p_method else 'cash' end, 'Μεμονωμένη προπόνηση');
  end if;
  select id into v_att from attendance where member_id = m.id and public.local_day(checked_in_at) = public.local_day(now())
    and membership_id is null and (class_type_id = t.id or class_type_id is null) order by (class_type_id = t.id) desc limit 1;
  if v_att is not null then
    update attendance set membership_id = v_ms, class_type_id = t.id where id = v_att;
    update memberships set visits_used = 1 where id = v_ms;
  elsif not exists (select 1 from attendance where member_id = m.id and class_type_id = t.id and public.local_day(checked_in_at) = public.local_day(now())) then
    insert into attendance (gym_id, member_id, method, class_type_id) values (m.gym_id, m.id, 'class', t.id);
  end if;
  return json_build_object('price', t.dropin_price, 'plan', 'Μεμονωμένη · ' || t.name, 'paid', p_paid);
end $$;

-- ---------- Εναλλαγή προγραμμάτων ανά δραστηριότητα ----------
create or replace function public.next_program(p_athlete uuid, p_ct uuid) returns uuid
language sql stable security invoker set search_path = public as $$
  with act as (select id, seq from programs where athlete_id = p_athlete and active and class_type_id is not distinct from p_ct),
       lastp as (select pr.seq from workout_sessions w join program_days d on d.id = w.program_day_id join programs pr on pr.id = d.program_id
                 where w.athlete_id = p_athlete and pr.class_type_id is not distinct from p_ct
                 order by w.performed_on desc, w.created_at desc limit 1)
  select coalesce(
    (select id from act where seq > (select seq from lastp) order by seq limit 1),
    (select id from act order by seq limit 1))
$$;
revoke execute on function public.next_program(uuid, uuid) from public, anon;
grant execute on function public.next_program(uuid, uuid) to authenticated;

create or replace view public.v_athlete_status with (security_invoker = true) as
select m.gym_id, m.id as athlete_id, m.full_name, m.coach_id,
       ls.last_workout,
       la.last_checkin::date as last_checkin,
       current_date - greatest(ls.last_workout, la.last_checkin::date) as days_absent,
       (select count(*) from public.workout_sessions w
         where w.athlete_id = m.id and w.performed_on >= current_date - 28) as workouts_28d,
       null::int as planned_28d,
       ap.total::int as program_total,
       ap.done::bigint as program_done,
       (select seq from public.programs where id = nx.id) as program_seq,
       ap.n::int as active_programs,
       nx.id as next_program_id,
       (select count(*)::int from public.programs c
         where c.athlete_id = m.id and c.completed_at is not null and c.completed_at > now() - interval '60 days'
           and not exists (select 1 from public.programs s where s.source_program_id = c.id)) as to_renew,
       ap.list as programs
from public.gym_members m
left join lateral (select max(performed_on) as last_workout from public.workout_sessions w where w.athlete_id = m.id) ls on true
left join lateral (select max(checked_in_at) as last_checkin from public.attendance a where a.member_id = m.id) la on true
left join lateral (select public.next_program(m.id) as id) nx on true
left join lateral (
  select count(*) as n, sum(x.total_sessions) as total, sum(x.done) as done,
         coalesce(json_agg(json_build_object('id', x.id, 'seq', x.seq, 'name', x.name, 'total', x.total_sessions, 'done', x.done,
                  'ct', x.class_type_id, 'activity', x.ct_name, 'next', x.id = x.nxt) order by x.ct_name nulls last, x.seq)
                  filter (where x.id is not null), '[]'::json) as list
  from (select p.id, p.seq, p.name, p.total_sessions, public.program_done(p.id) as done, p.class_type_id, ct.name as ct_name,
               public.next_program(m.id, p.class_type_id) as nxt
        from public.programs p left join public.class_types ct on ct.id = p.class_type_id
        where p.athlete_id = m.id and p.active) x) ap on true
where m.is_athlete and m.status = 'active';
grant select on public.v_athlete_status to authenticated;

-- Παρουσίες ανά δραστηριότητα (για τη σελίδα αθλητή και την οθόνη του αθλητή)
create or replace function public.activity_counts(p_member uuid, p_days int default 28)
returns table(class_type_id uuid, name text, color text, has_program boolean, n int, last_day date)
language sql stable security definer set search_path = public as $$
  select ct.id, ct.name, ct.color, ct.has_program, count(*)::int, max(public.local_day(a.checked_in_at))
  from attendance a join class_types ct on ct.id = a.class_type_id
  join gym_members m on m.id = a.member_id
  where a.member_id = p_member and a.checked_in_at >= now() - make_interval(days => p_days)
    and (public.is_gym_staff(m.gym_id) or public.is_me(p_member))
  group by ct.id, ct.name, ct.color, ct.has_program
  order by count(*) desc
$$;
revoke execute on function public.activity_counts(uuid, int) from public, anon;
grant execute on function public.activity_counts(uuid, int) to authenticated;

revoke execute on function public.valid_membership_for(uuid, date, uuid), public.week_used(uuid, uuid, date, uuid) from public, anon;
grant execute on function public.valid_membership_for(uuid, date, uuid), public.week_used(uuid, uuid, date, uuid) to authenticated;

-- ---------- Υπάρχοντα δεδομένα ----------
-- Personal: συνήθως με πρόγραμμα
update public.class_types set has_program = true where kind = 'personal' and not has_program;
-- Γυμναστήρια με προγράμματα χωρίς δραστηριότητα: νέα δραστηριότητα «Gym» με πρόγραμμα, και όλα τα προγράμματα πάνε εκεί
insert into public.class_types (gym_id, name, kind, capacity, duration_min, has_program)
select distinct p.gym_id, 'Gym', 'group', 20, 60, true from public.programs p
where p.class_type_id is null
  and not exists (select 1 from public.class_types c where c.gym_id = p.gym_id and c.name = 'Gym');
update public.class_types set has_program = true where name = 'Gym';
update public.programs p set class_type_id = c.id from public.class_types c
where p.class_type_id is null and c.gym_id = p.gym_id and c.name = 'Gym';
-- Παλιές παρουσίες σε ημέρες με καταγραφή προπόνησης: δραστηριότητα του προγράμματος
update public.attendance a set class_type_id = x.ct from (
  select w.athlete_id, w.performed_on, min(pr.class_type_id::text)::uuid as ct
  from public.workout_sessions w join public.program_days d on d.id = w.program_day_id join public.programs pr on pr.id = d.program_id
  group by w.athlete_id, w.performed_on) x
where a.class_type_id is null and a.member_id = x.athlete_id and public.local_day(a.checked_in_at) = x.performed_on;
-- Παλιές παρουσίες από τμήμα: δραστηριότητα της κράτησης της ημέρας
update public.attendance a set class_type_id = s.class_type_id
from public.bookings b join public.class_sessions s on s.id = b.session_id
where a.class_type_id is null and b.member_id = a.member_id and b.status = 'attended'
  and public.local_day(s.starts_at) = public.local_day(a.checked_in_at);
