-- Omnisoft Gym — 14: πολλά ενεργά προγράμματα ανά αθλητή με εναλλαγή (Πόδια → Στήθος → Πόδια …)
-- * Νέο πρόγραμμα μπαίνει στην εναλλαγή (δεν κλείνει τα άλλα).
-- * Όταν ένα πρόγραμμα φτάσει τις προπονήσεις του, κλείνει μόνο του (completed_at). Τα υπόλοιπα συνεχίζουν.
-- * Το επόμενο πρόγραμμα = το επόμενο ενεργό σε αρίθμηση μετά από αυτό της τελευταίας προπόνησης.
-- * Προεπιλογή προπονήσεων: 4.

alter table public.programs add column if not exists completed_at timestamptz;
alter table public.programs add column if not exists source_program_id uuid references public.programs(id) on delete set null;
alter table public.programs alter column total_sessions set default 4;

-- Νέο πρόγραμμα αθλητή: επόμενος αριθμός, όνομα «Πρόγραμμα N». ΔΕΝ κλείνει τα υπόλοιπα (εναλλαγή).
create or replace function public.tg_program_seq() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.athlete_id is not null then
    select coalesce(max(seq), 0) + 1 into new.seq from programs where athlete_id = new.athlete_id;
    if new.name is null or new.name = '' or new.name = 'Νέο πρόγραμμα' or not new.is_template then new.name := 'Πρόγραμμα ' || new.seq; end if;
  end if;
  return new;
end $$;

create or replace function public.program_done(p uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from workout_sessions w join program_days d on d.id = w.program_day_id where d.program_id = p
$$;

-- Αυτόματο κλείσιμο / άνοιγμα με βάση τις προπονήσεις
create or replace function public.tg_program_autoclose() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_prog uuid; v_done int; pr programs%rowtype;
begin
  for v_prog in
    select d.program_id from program_days d where d.id in (
      case when tg_op <> 'DELETE' then new.program_day_id end, case when tg_op <> 'INSERT' then old.program_day_id end)
  loop
    select * into pr from programs where id = v_prog;
    continue when pr.athlete_id is null;
    v_done := public.program_done(v_prog);
    if pr.active and v_done >= pr.total_sessions then
      update programs set active = false, completed_at = now(), end_date = current_date where id = v_prog;
    elsif not pr.active and pr.completed_at is not null and v_done < pr.total_sessions then
      update programs set active = true, completed_at = null, end_date = null where id = v_prog;   -- σβήστηκε προπόνηση
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists trg_d_program_autoclose on public.workout_sessions;
create trigger trg_d_program_autoclose after insert or delete or update of program_day_id on public.workout_sessions
  for each row execute function public.tg_program_autoclose();

-- Αλλαγή συνόλου ή χειροκίνητο άνοιγμα/κλείσιμο
create or replace function public.tg_program_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_done int;
begin
  if new.athlete_id is null then return new; end if;
  if new.active and not old.active then new.completed_at := null; new.end_date := null; end if;
  if not new.active and old.active and new.completed_at is null then new.end_date := coalesce(new.end_date, current_date); end if;
  if new.total_sessions is distinct from old.total_sessions then
    v_done := public.program_done(new.id);
    if new.active and v_done >= new.total_sessions then
      new.active := false; new.completed_at := now(); new.end_date := current_date;
    elsif not new.active and old.completed_at is not null and v_done < new.total_sessions then
      new.active := true; new.completed_at := null; new.end_date := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_d_program_total on public.programs;
create trigger trg_d_program_total before update on public.programs for each row execute function public.tg_program_total();

-- Επόμενο πρόγραμμα της εναλλαγής
create or replace function public.next_program(p_athlete uuid) returns uuid
language sql stable security invoker set search_path = public as $$
  with act as (select id, seq from programs where athlete_id = p_athlete and active),
       lastp as (select pr.seq from workout_sessions w join program_days d on d.id = w.program_day_id join programs pr on pr.id = d.program_id
                 where w.athlete_id = p_athlete order by w.performed_on desc, w.created_at desc limit 1)
  select coalesce(
    (select id from act where seq > (select seq from lastp) order by seq limit 1),
    (select id from act order by seq limit 1))
$$;

-- Κατάσταση αθλητή: σύνολα από όλα τα ενεργά προγράμματα + λίστα + όσα έκλεισαν και θέλουν ανανέωση
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
                  'next', x.id = nx.id) order by x.seq) filter (where x.id is not null), '[]'::json) as list
  from (select p.id, p.seq, p.name, p.total_sessions, public.program_done(p.id) as done
        from public.programs p where p.athlete_id = m.id and p.active) x) ap on true
where m.is_athlete and m.status = 'active';
grant select on public.v_athlete_status to authenticated;

revoke execute on function public.program_done(uuid), public.next_program(uuid), public.tg_program_autoclose(), public.tg_program_total() from public, anon;
grant execute on function public.program_done(uuid), public.next_program(uuid) to authenticated;
