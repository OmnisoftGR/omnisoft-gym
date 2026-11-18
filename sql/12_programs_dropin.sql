-- Omnisoft Gym — 12: προγράμματα «Πρόγραμμα 1, 2, 3…» ανά αθλητή (μία λίστα ασκήσεων το καθένα),
-- μεμονωμένες προπονήσεις με τιμή ανά τμήμα, επισκέπτες χωρίς email

-- ---------- A. Αρίθμηση προγραμμάτων ανά αθλητή ----------
alter table public.programs add column if not exists seq int;

-- Κάθε ημέρα παλιού πολυήμερου προγράμματος γίνεται ξεχωριστό πρόγραμμα (το ιστορικό ακολουθεί την ημέρα)
do $$
declare p record; d record; np uuid; n int;
begin
  for p in select * from programs where (select count(*) from program_days x where x.program_id = programs.id) > 1 loop
    n := 0;
    for d in select * from program_days where program_id = p.id order by day_no loop
      n := n + 1;
      if n = 1 then
        if p.is_template then update programs set name = p.name || ' · ' || d.name where id = p.id; end if;
        update program_days set day_no = 1 where id = d.id;
        continue;
      end if;
      insert into programs (gym_id, athlete_id, coach_id, name, goal, is_template, start_date, active, total_sessions, notes)
      values (p.gym_id, p.athlete_id, p.coach_id, case when p.is_template then p.name || ' · ' || d.name else d.name end,
              p.goal, p.is_template, p.start_date + n, p.is_template, p.total_sessions, p.notes)
      returning id into np;
      update program_days set program_id = np, day_no = 1 where id = d.id;
    end loop;
  end loop;
end $$;

-- Αρίθμηση, ονόματα, ένα ενεργό (το τελευταίο) ανά αθλητή
with o as (select id, row_number() over (partition by athlete_id order by start_date, created_at) rn,
                  count(*) over (partition by athlete_id) cnt
           from programs where athlete_id is not null)
update programs p set seq = o.rn, name = 'Πρόγραμμα ' || o.rn, active = (o.rn = o.cnt)
from o where o.id = p.id;
-- προπονήσεις: τα παλιά «ολοκληρωμένα», το ενεργό με περιθώριο
with x as (select d.program_id, count(*) done from workout_sessions w join program_days d on d.id = w.program_day_id group by 1)
update programs p set total_sessions = case when p.active then greatest(12, x.done + 4) else greatest(1, x.done) end
from x where x.program_id = p.id and p.athlete_id is not null;

-- Νέο πρόγραμμα αθλητή: επόμενος αριθμός, όνομα «Πρόγραμμα N», τα προηγούμενα κλείνουν
create or replace function public.tg_program_seq() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.athlete_id is not null then
    select coalesce(max(seq), 0) + 1 into new.seq from programs where athlete_id = new.athlete_id;
    if new.name is null or new.name = '' or new.name = 'Νέο πρόγραμμα' or not new.is_template then new.name := 'Πρόγραμμα ' || new.seq; end if;
    if new.active then
      update programs set active = false, end_date = coalesce(end_date, current_date) where athlete_id = new.athlete_id and active;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_c_program_seq on public.programs;
create trigger trg_c_program_seq before insert on public.programs for each row execute function public.tg_program_seq();

-- Προτάσεις: ομαδοποίηση με το όνομα του προγράμματος
create or replace function public.suggest_progression(p_athlete uuid)
returns table (program_exercise_id uuid, program_day text, exercise_name text, sets int,
               reps_min int, reps_max int, last_date date, last_weight numeric, last_reps text,
               suggested_weight numeric, status text, reason text)
language plpgsql stable security invoker set search_path = public as $$
declare
  r record; v_last date; v_w numeric; v_allmax boolean; v_nsets int; v_fails int; v_days int;
begin
  for r in
    select pe.*, pr.name as day_name, e.name as ex_name, e.metric_type,
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

-- Αριθμός ενεργού προγράμματος στην κατάσταση αθλητή
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
         where w.athlete_id = m.id and d.program_id = ap.id) as program_done,
       ap.seq as program_seq
from public.gym_members m
left join lateral (select max(performed_on) as last_workout from public.workout_sessions w where w.athlete_id = m.id) ls on true
left join lateral (select max(checked_in_at) as last_checkin from public.attendance a where a.member_id = m.id) la on true
left join lateral (select p.id, p.total_sessions, p.seq from public.programs p
                   where p.athlete_id = m.id and p.active order by p.start_date desc limit 1) ap on true
where m.is_athlete and m.status = 'active';
grant select on public.v_athlete_status to authenticated;

-- ---------- B. Μεμονωμένες προπονήσεις ----------
alter table public.class_types add column if not exists dropin_price numeric(8,2);
alter table public.gym_members alter column email drop not null;   -- επισκέπτες χωρίς email

-- Μεμονωμένη προπόνηση: συνδρομή 1 επίσκεψης για σήμερα + (προαιρετικά) πληρωμή + παρουσία.
-- Το προσωπικό (και ο προπονητής) βλέπει μόνο την τιμή της μεμονωμένης, όχι τις υπόλοιπες πληρωμές.
create or replace function public.dropin(p_member uuid, p_class_type uuid, p_paid boolean, p_method text default 'cash')
returns json language plpgsql security definer set search_path = public as $$
declare m gym_members%rowtype; t class_types%rowtype; v_ms uuid; v_att uuid;
begin
  select * into m from gym_members where id = p_member;
  if m.id is null or not public.is_gym_staff(m.gym_id) then raise exception 'Χωρίς πρόσβαση'; end if;
  select * into t from class_types where id = p_class_type and gym_id = m.gym_id;
  if t.id is null then raise exception 'Άγνωστο τμήμα'; end if;
  if t.dropin_price is null then raise exception 'Δεν έχει οριστεί τιμή μεμονωμένης για το %', t.name; end if;
  insert into memberships (gym_id, member_id, plan_name, kind, start_date, end_date, visits_total, price, notes)
  values (m.gym_id, m.id, 'Μεμονωμένη · ' || t.name, 'visits', current_date, current_date, 1, t.dropin_price, 'Μεμονωμένη προπόνηση')
  returning id into v_ms;
  if p_paid and t.dropin_price > 0 then
    insert into payments (gym_id, member_id, membership_id, amount, method, notes)
    values (m.gym_id, m.id, v_ms, t.dropin_price, case when p_method in ('cash','card','iris','bank','other') then p_method else 'cash' end, 'Μεμονωμένη προπόνηση');
  end if;
  select id into v_att from attendance where member_id = m.id and checked_in_at::date = current_date and membership_id is null limit 1;
  if v_att is null and not exists (select 1 from attendance where member_id = m.id and checked_in_at::date = current_date) then
    insert into attendance (gym_id, member_id, method) values (m.gym_id, m.id, 'class');   -- ο trigger χρεώνει την επίσκεψη
  elsif v_att is not null then
    update attendance set membership_id = v_ms where id = v_att;
    update memberships set visits_used = 1 where id = v_ms;
  end if;
  return json_build_object('price', t.dropin_price, 'plan', 'Μεμονωμένη · ' || t.name, 'paid', p_paid);
end $$;
revoke execute on function public.dropin(uuid, uuid, boolean, text), public.tg_program_seq() from public, anon;
grant execute on function public.dropin(uuid, uuid, boolean, text) to authenticated;
revoke execute on function public.tg_program_seq() from authenticated;
