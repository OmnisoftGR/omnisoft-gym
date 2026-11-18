-- =====================================================================
-- Omnisoft Gym — progression, πρόοδος, απουσίες (όλα με τα δικαιώματα του χρήστη: security invoker)
-- =====================================================================

-- Πρόοδος ανά άσκηση και ημέρα (για γραφήματα): μέγιστα κιλά, εκτίμηση 1RM, όγκος
create or replace view public.v_exercise_progress with (security_invoker = true) as
select ws.gym_id, ws.athlete_id, s.exercise_id, e.name as exercise_name, ws.performed_on,
       max(s.weight)                                             as top_weight,
       max(s.reps)                                               as top_reps,
       round(max(s.weight * (1 + s.reps / 30.0)), 1)             as est_1rm,   -- Epley
       sum(coalesce(s.weight, 0) * coalesce(s.reps, 0))          as volume_kg,
       count(*)                                                  as sets_done,
       round(avg(s.rpe), 1)                                      as avg_rpe
from public.workout_sessions ws
join public.workout_sets s on s.session_id = ws.id
join public.exercises e on e.id = s.exercise_id
group by ws.gym_id, ws.athlete_id, s.exercise_id, e.name, ws.performed_on;

-- Αθλητές με τελευταία προπόνηση/παρουσία και ημέρες απουσίας (για τον προπονητή)
create or replace view public.v_athlete_status with (security_invoker = true) as
select m.gym_id, m.id as athlete_id, m.full_name, m.coach_id,
       ls.last_workout,
       la.last_checkin::date as last_checkin,
       current_date - greatest(ls.last_workout, la.last_checkin::date) as days_absent,
       (select count(*) from public.workout_sessions w
         where w.athlete_id = m.id and w.performed_on >= current_date - 28) as workouts_28d,
       (select p.sessions_per_week * 4 from public.programs p
         where p.athlete_id = m.id and p.active order by p.start_date desc limit 1) as planned_28d
from public.gym_members m
left join lateral (select max(performed_on) as last_workout from public.workout_sessions w where w.athlete_id = m.id) ls on true
left join lateral (select max(checked_in_at) as last_checkin from public.attendance a where a.member_id = m.id) la on true
where m.is_athlete and m.status = 'active';

-- ---------------------------------------------------------------------
-- Πρόταση για την επόμενη προπόνηση ανά άσκηση του ενεργού προγράμματος.
-- Κανόνες (ρυθμίζονται ανά γυμναστήριο στο progression_settings):
--  1. Καμία καταγραφή            → κιλά-στόχος του προγράμματος
--  2. Απουσία > missed_days_deload → μείωση deload_pct %
--  3. Απουσία > missed_days_hold   → ίδια κιλά
--  4. fails_for_decrease διαδοχικές προπονήσεις κάτω από reps_min → μείωση decrease_pct %
--  5. Όλα τα σετ στο reps_max με RPE ≤ max_rpe_for_increase      → αύξηση κατά increment
--  6. Χωρίς βελτίωση εκτ. 1RM σε stall_sessions προπονήσεις      → «στασιμότητα», σήμα στον προπονητή
--  7. Αλλιώς ίδια κιλά, στόχος +1 επανάληψη
-- ---------------------------------------------------------------------
create or replace function public.suggest_progression(p_athlete uuid)
returns table (program_exercise_id uuid, program_day text, exercise_name text, sets int,
               reps_min int, reps_max int, last_date date, last_weight numeric, last_reps text,
               suggested_weight numeric, status text, reason text)
language plpgsql stable security invoker set search_path = public as $$
declare
  r record; cfg progression_settings%rowtype;
  v_last date; v_w numeric; v_minreps int; v_allmax boolean; v_rpe numeric; v_nsets int;
  v_fails int; v_best_recent numeric; v_best_before numeric; v_inc numeric; v_days int;
begin
  for r in
    select pe.*, d.name as day_name, e.name as ex_name, coalesce(pe.increment_kg, e.increment_kg) as inc,
           pr.gym_id as g
    from programs pr
    join program_days d on d.program_id = pr.id
    join program_exercises pe on pe.program_day_id = d.id
    join exercises e on e.id = pe.exercise_id
    where pr.athlete_id = p_athlete and pr.active
    order by d.day_no, pe.sort_order
  loop
    select * into cfg from progression_settings where gym_id = r.g;
    program_exercise_id := r.id; program_day := r.day_name; exercise_name := r.ex_name;
    sets := r.sets; reps_min := r.reps_min; reps_max := r.reps_max; v_inc := r.inc;

    -- τελευταία προπόνηση με αυτή την άσκηση
    select ws.performed_on into v_last
    from workout_sessions ws join workout_sets s on s.session_id = ws.id
    where ws.athlete_id = p_athlete and s.exercise_id = r.exercise_id
    order by ws.performed_on desc limit 1;

    last_date := v_last;
    if v_last is null then
      last_weight := null; last_reps := null;
      suggested_weight := r.target_weight; status := 'new';
      reason := 'Πρώτη φορά: ξεκίνα με τα κιλά του προγράμματος';
      return next; continue;
    end if;

    select max(s.weight), min(s.reps), bool_and(s.reps >= coalesce(r.reps_max, r.reps_min, 0)),
           avg(s.rpe), count(*), string_agg(s.reps::text, '-' order by s.set_no)
      into v_w, v_minreps, v_allmax, v_rpe, v_nsets, last_reps
    from workout_sessions ws join workout_sets s on s.session_id = ws.id
    where ws.athlete_id = p_athlete and s.exercise_id = r.exercise_id and ws.performed_on = v_last;

    last_weight := v_w;
    v_days := current_date - v_last;

    -- διαδοχικές αποτυχίες (πιο πρόσφατες πρώτα)
    select count(*) into v_fails from (
      select x.failed, sum(case when x.failed then 0 else 1 end) over (order by x.d desc) as grp
      from (select ws.performed_on d, min(s.reps) < coalesce(r.reps_min, 0) as failed
            from workout_sessions ws join workout_sets s on s.session_id = ws.id
            where ws.athlete_id = p_athlete and s.exercise_id = r.exercise_id
            group by ws.performed_on) x
    ) y where y.grp = 0;

    -- στασιμότητα: καλύτερο 1RM των τελευταίων Ν προπονήσεων vs πριν από αυτές
    with h as (
      select ws.performed_on d, max(s.weight * (1 + s.reps / 30.0)) e1,
             row_number() over (order by ws.performed_on desc) rn
      from workout_sessions ws join workout_sets s on s.session_id = ws.id
      where ws.athlete_id = p_athlete and s.exercise_id = r.exercise_id
      group by ws.performed_on)
    select max(e1) filter (where rn <= cfg.stall_sessions),
           max(e1) filter (where rn >  cfg.stall_sessions)
      into v_best_recent, v_best_before from h;

    if v_days > cfg.missed_days_deload then
      suggested_weight := (round(v_w * (1 - cfg.deload_pct / 100) * 2) / 2)::numeric(6,1);
      status := 'deload';
      reason := format('Απουσία %s ημερών: μείωση %s%%', v_days, cfg.deload_pct::float);
    elsif v_days > cfg.missed_days_hold then
      suggested_weight := v_w; status := 'hold';
      reason := format('Απουσία %s ημερών: ίδια κιλά για επανέναρξη', v_days);
    elsif v_fails >= cfg.fails_for_decrease then
      suggested_weight := (round(v_w * (1 - cfg.decrease_pct / 100) * 2) / 2)::numeric(6,1);
      status := 'decrease';
      reason := format('%s προπονήσεις κάτω από %s επαναλήψεις: μείωση %s%%', v_fails, r.reps_min, cfg.decrease_pct::float);
    elsif v_allmax and v_nsets >= r.sets and coalesce(v_rpe, 0) <= cfg.max_rpe_for_increase then
      suggested_weight := v_w + v_inc; status := 'increase';
      reason := format('Όλα τα σετ στις %s επαναλήψεις: +%s κιλά', coalesce(r.reps_max, r.reps_min), v_inc::float);
    elsif v_best_before is not null and v_best_recent <= v_best_before then
      suggested_weight := v_w; status := 'stall';
      reason := format('Χωρίς βελτίωση στις τελευταίες %s προπονήσεις: ενημέρωσε τον προπονητή', cfg.stall_sessions);
    else
      suggested_weight := v_w; status := 'hold';
      reason := 'Ίδια κιλά, στόχος +1 επανάληψη';
    end if;
    return next;
  end loop;
end $$;

grant select on public.v_exercise_progress, public.v_athlete_status to authenticated;
grant execute on function public.suggest_progression(uuid) to authenticated;
