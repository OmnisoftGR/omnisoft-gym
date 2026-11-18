-- Omnisoft Gym — 7: συνδρομές αθλητών (πακέτα, συνδρομές, πληρωμές, πάγωμα, επισκέψεις)
-- Η εφαρμογή ΚΑΤΑΓΡΑΦΕΙ πληρωμές· δεν εκδίδει φορολογικά παραστατικά.

-- Πολιτική για ληγμένη συνδρομή / οφειλή: 'warn' = μόνο σήμανση, 'block' = ο αθλητής δεν καταγράφει προπόνηση
alter table public.gyms add column if not exists expired_policy text not null default 'warn'
  check (expired_policy in ('warn','block'));
alter table public.gyms add column if not exists expiring_days int not null default 7;

-- ---------- Πακέτα ----------
create table public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('time','visits')),
  months int check (months > 0),                 -- χρονικό πακέτο
  visits int check (visits > 0),                 -- πακέτο επισκέψεων
  valid_days int check (valid_days > 0),         -- προαιρετική λήξη πακέτου επισκέψεων
  price numeric(8,2) not null default 0,
  active boolean not null default true,
  sort_order int not null default 1,
  created_at timestamptz not null default now(),
  check ((kind = 'time' and months is not null) or (kind = 'visits' and visits is not null))
);

-- ---------- Συνδρομές ----------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  plan_id uuid references public.membership_plans(id) on delete set null,
  plan_name text not null,
  kind text not null check (kind in ('time','visits')),
  start_date date not null default current_date,
  end_date date,                                 -- null = πακέτο επισκέψεων χωρίς λήξη
  visits_total int,
  visits_used int not null default 0,
  price numeric(8,2) not null default 0,         -- τελική τιμή (μετά από έκπτωση)
  status text not null default 'active' check (status in ('active','frozen','cancelled')),
  frozen_from date,
  frozen_days int not null default 0,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.memberships (member_id, start_date desc);

-- ---------- Πληρωμές ----------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  membership_id uuid references public.memberships(id) on delete set null,
  amount numeric(8,2) not null check (amount <> 0),
  paid_on date not null default current_date,
  method text not null default 'cash' check (method in ('cash','card','iris','bank','other')),
  notes text,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.payments (gym_id, paid_on desc);
create index on public.payments (member_id);

alter table public.attendance add column if not exists membership_id uuid references public.memberships(id) on delete set null;

-- gym_id από το μέλος
create or replace function public.tg_gym_from_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select gym_id into new.gym_id from gym_members where id = new.member_id;
  return new;
end $$;
create trigger trg_a_gym before insert or update on public.memberships for each row execute function public.tg_gym_from_member();
create trigger trg_a_gym before insert or update on public.payments    for each row execute function public.tg_gym_from_member();

-- ---------- Έγκυρη συνδρομή μέλους σε μια ημερομηνία ----------
create or replace function public.valid_membership(p_member uuid, p_day date default current_date)
returns uuid language sql stable security definer set search_path = public as $$
  select id from memberships
  where member_id = p_member and status = 'active' and start_date <= p_day
    and (end_date is null or end_date >= p_day)
    and (kind = 'time' or visits_used < visits_total)
  order by (kind = 'visits') desc, coalesce(end_date, '9999-12-31') asc
  limit 1
$$;

-- Κατανάλωση επίσκεψης με κάθε παρουσία (πακέτα επισκέψεων) — και επιστροφή όταν σβηστεί
create or replace function public.tg_attendance_visit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if tg_op = 'INSERT' then
    select id into v from memberships
    where member_id = new.member_id and status = 'active' and kind = 'visits' and visits_used < visits_total
      and start_date <= new.checked_in_at::date and (end_date is null or end_date >= new.checked_in_at::date)
    order by coalesce(end_date, '9999-12-31'), start_date limit 1;
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
create trigger trg_attendance_visit_ins before insert on public.attendance for each row execute function public.tg_attendance_visit();
create trigger trg_attendance_visit_del after delete on public.attendance for each row execute function public.tg_attendance_visit();

-- Πολιτική «μπλοκάρισμα»: ο αθλητής δεν καταγράφει προπόνηση χωρίς έγκυρη συνδρομή
create or replace function public.tg_session_policy() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_gym_staff(new.gym_id)
     and (select expired_policy from gyms where id = new.gym_id) = 'block'
     and public.valid_membership(new.athlete_id, new.performed_on) is null then
    raise exception 'Η συνδρομή σας δεν είναι ενεργή. Επικοινωνήστε με το γυμναστήριο.';
  end if;
  return new;
end $$;
create trigger trg_b_policy before insert on public.workout_sessions for each row execute function public.tg_session_policy();

-- ---------- Κατάσταση συνδρομής ανά μέλος (για προπονητές: χωρίς ποσά) ----------
create or replace function public.sub_status(p_gym uuid)
returns table (member_id uuid, status text, plan_name text, end_date date, visits_left int, has_debt boolean)
language sql stable security definer set search_path = public as $$
  with m as (select id from gym_members where gym_id = p_gym and is_athlete),
  cur as (
    select distinct on (s.member_id) s.* from memberships s
    where s.gym_id = p_gym and s.status <> 'cancelled'
    order by s.member_id, (s.id = public.valid_membership(s.member_id)) desc, s.start_date desc
  ),
  bal as (
    select x.member_id, sum(x.v) as b from (
      select member_id, price v from memberships where gym_id = p_gym and status <> 'cancelled'
      union all select member_id, -amount from payments where gym_id = p_gym) x group by x.member_id
  ),
  g as (select expiring_days from gyms where id = p_gym)
  select m.id,
    case
      when c.id is null then 'none'
      when c.status = 'frozen' then 'frozen'
      when public.valid_membership(m.id) is null then 'expired'
      when (c.end_date is not null and c.end_date <= current_date + (select expiring_days from g))
        or (c.kind = 'visits' and c.visits_total - c.visits_used <= 2) then 'expiring'
      else 'active' end,
    c.plan_name, c.end_date,
    case when c.kind = 'visits' then c.visits_total - c.visits_used end,
    coalesce(b.b, 0) > 0.009
  from m left join cur c on c.member_id = m.id left join bal b on b.member_id = m.id
  where public.is_gym_staff(p_gym)
$$;

-- ---------- Πάγωμα / ξεπάγωμα / ανανέωση ----------
create or replace function public.freeze_membership(p_id uuid, p_freeze boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s memberships%rowtype; d int;
begin
  select * into s from memberships where id = p_id;
  if s.id is null or not public.is_gym_owner(s.gym_id) then raise exception 'Μόνο ο ιδιοκτήτης'; end if;
  if p_freeze and s.status = 'active' then
    update memberships set status = 'frozen', frozen_from = current_date where id = p_id;
  elsif not p_freeze and s.status = 'frozen' then
    d := greatest(0, current_date - s.frozen_from);
    update memberships set status = 'active', frozen_from = null, frozen_days = frozen_days + d,
      end_date = case when end_date is null then null else end_date + d end where id = p_id;
  end if;
end $$;

create or replace function public.new_membership(p_member uuid, p_plan uuid, p_start date default null,
                                                 p_price numeric default null, p_paid numeric default 0,
                                                 p_method text default 'cash', p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare pl membership_plans%rowtype; mem gym_members%rowtype; v_start date; v_end date; v_id uuid; v_last date;
begin
  select * into mem from gym_members where id = p_member;
  select * into pl from membership_plans where id = p_plan and gym_id = mem.gym_id;
  if pl.id is null or not public.is_gym_owner(mem.gym_id) then raise exception 'Μόνο ο ιδιοκτήτης'; end if;
  -- ανανέωση: ξεκινά μετά τη λήξη της τρέχουσας χρονικής συνδρομής
  select max(end_date) into v_last from memberships where member_id = p_member and status = 'active' and kind = pl.kind;
  v_start := coalesce(p_start, greatest(current_date, coalesce(v_last + 1, current_date)));
  v_end := case when pl.kind = 'time' then (v_start + make_interval(months => pl.months))::date - 1
                when pl.valid_days is not null then v_start + pl.valid_days - 1 end;
  insert into memberships (gym_id, member_id, plan_id, plan_name, kind, start_date, end_date, visits_total, price, notes)
  values (mem.gym_id, p_member, pl.id, pl.name, pl.kind, v_start, v_end, pl.visits, coalesce(p_price, pl.price), p_notes)
  returning id into v_id;
  if coalesce(p_paid, 0) > 0 then
    insert into payments (gym_id, member_id, membership_id, amount, method) values (mem.gym_id, p_member, v_id, p_paid, p_method);
  end if;
  return v_id;
end $$;

-- Check-in με κάρτα: επιστρέφει και την κατάσταση συνδρομής
create or replace function public.rfid_checkin(p_gym uuid, p_tag text)
returns text language plpgsql security definer set search_path = public as $$
declare v_member uuid; v_name text; v_st text;
begin
  if not public.is_gym_staff(p_gym) then raise exception 'Μόνο για το προσωπικό'; end if;
  select id, full_name into v_member, v_name from gym_members
  where gym_id = p_gym and rfid_tag = trim(p_tag) and status = 'active';
  if v_member is null then raise exception 'Άγνωστη κάρτα'; end if;
  if exists (select 1 from attendance where member_id = v_member and checked_in_at::date = current_date) then
    return v_name || ' (ήδη παρών)';
  end if;
  insert into attendance (gym_id, member_id, method) values (p_gym, v_member, 'rfid');
  select s.status into v_st from public.sub_status(p_gym) s where s.member_id = v_member;
  return v_name || case v_st when 'expired' then ' · ⚠ ληγμένη συνδρομή' when 'none' then ' · ⚠ χωρίς συνδρομή'
                             when 'expiring' then ' · λήγει σύντομα' when 'frozen' then ' · συνδρομή σε πάγωμα' else '' end;
end $$;

-- ---------- RLS ----------
alter table public.membership_plans enable row level security;
alter table public.memberships enable row level security;
alter table public.payments enable row level security;

create policy plans_select on public.membership_plans for select to authenticated using (public.is_gym_member(gym_id));
create policy plans_write on public.membership_plans for all to authenticated
  using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));
-- συνδρομές/πληρωμές: ο ιδιοκτήτης τα πάντα, ο αθλητής βλέπει τις δικές του
create policy memberships_select on public.memberships for select to authenticated
  using (public.is_gym_owner(gym_id) or public.is_me(member_id));
create policy memberships_write on public.memberships for all to authenticated
  using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));
create policy payments_select on public.payments for select to authenticated
  using (public.is_gym_owner(gym_id) or public.is_me(member_id));
create policy payments_write on public.payments for all to authenticated
  using (public.is_gym_owner(gym_id)) with check (public.is_gym_owner(gym_id));

grant select, insert, update, delete on public.membership_plans, public.memberships, public.payments to authenticated;

revoke execute on function public.valid_membership(uuid, date), public.sub_status(uuid), public.freeze_membership(uuid, boolean),
  public.new_membership(uuid, uuid, date, numeric, numeric, text, text) from public, anon;
grant execute on function public.valid_membership(uuid, date), public.sub_status(uuid), public.freeze_membership(uuid, boolean),
  public.new_membership(uuid, uuid, date, numeric, numeric, text, text) to authenticated;
revoke execute on function public.tg_gym_from_member(), public.tg_attendance_visit(), public.tg_session_policy() from public, anon, authenticated;

-- ---------- Demo δεδομένα (μόνο για το demo γυμναστήριο) ----------
do $$
declare g uuid; p1 uuid; p2 uuid; p3 uuid; m record; s uuid;
begin
  select id into g from gyms where name in ('Demo Fight Club', 'Fit or Fight') order by name limit 1;
  if g is null or exists (select 1 from membership_plans where gym_id = g) then return; end if;
  insert into membership_plans (gym_id, name, kind, months, price, sort_order) values (g, 'Μηνιαίο kickboxing', 'time', 1, 50, 1) returning id into p1;
  insert into membership_plans (gym_id, name, kind, months, price, sort_order) values (g, 'Τρίμηνο kickboxing', 'time', 3, 135, 2) returning id into p2;
  insert into membership_plans (gym_id, name, kind, visits, valid_days, price, sort_order) values (g, '10 personal', 'visits', 10, 90, 200, 3) returning id into p3;
  insert into membership_plans (gym_id, name, kind, months, price, sort_order) values (g, 'Ετήσιο', 'time', 12, 480, 4);

  for m in select id, email from gym_members where gym_id = g and is_athlete loop
    if m.email like 'user@%' or m.email like 'nikos@%' then          -- ενεργή, εξοφλημένη (με ιστορικό)
      insert into memberships (gym_id, member_id, plan_id, plan_name, kind, start_date, end_date, price)
        values (g, m.id, p1, 'Μηνιαίο kickboxing', 'time', current_date - 75, current_date - 46, 50) returning id into s;
      insert into payments (gym_id, member_id, membership_id, amount, paid_on, method) values (g, m.id, s, 50, current_date - 75, 'cash');
      insert into memberships (gym_id, member_id, plan_id, plan_name, kind, start_date, end_date, price)
        values (g, m.id, p2, 'Τρίμηνο kickboxing', 'time', current_date - 45, current_date + 45, 135) returning id into s;
      insert into payments (gym_id, member_id, membership_id, amount, paid_on, method) values (g, m.id, s, 135, current_date - 45, 'card');
    elsif m.email like 'maria@%' then                                  -- ληγμένη με οφειλή
      insert into memberships (gym_id, member_id, plan_id, plan_name, kind, start_date, end_date, price)
        values (g, m.id, p1, 'Μηνιαίο kickboxing', 'time', current_date - 40, current_date - 11, 50);
    elsif m.email like 'kostas@%' then                                 -- λήγει σε 3 ημέρες
      insert into memberships (gym_id, member_id, plan_id, plan_name, kind, start_date, end_date, price)
        values (g, m.id, p1, 'Μηνιαίο kickboxing', 'time', current_date - 27, current_date + 3, 50) returning id into s;
      insert into payments (gym_id, member_id, membership_id, amount, paid_on, method) values (g, m.id, s, 50, current_date - 27, 'iris');
    elsif m.email like 'eleni@%' then                                  -- πακέτο επισκέψεων, μερική πληρωμή
      insert into memberships (gym_id, member_id, plan_id, plan_name, kind, start_date, end_date, visits_total, visits_used, price)
        values (g, m.id, p3, '10 personal', 'visits', current_date - 30, current_date + 60, 10, 7, 200) returning id into s;
      insert into payments (gym_id, member_id, membership_id, amount, paid_on, method) values (g, m.id, s, 100, current_date - 30, 'cash');
    elsif m.email like 'sofia@%' then                                  -- σε πάγωμα
      insert into memberships (gym_id, member_id, plan_id, plan_name, kind, start_date, end_date, price, status, frozen_from)
        values (g, m.id, p1, 'Μηνιαίο kickboxing', 'time', current_date - 20, current_date + 10, 50, 'frozen', current_date - 14) returning id into s;
      insert into payments (gym_id, member_id, membership_id, amount, paid_on, method) values (g, m.id, s, 50, current_date - 20, 'bank');
    end if;                                                            -- giannis: χωρίς συνδρομή
  end loop;
end $$;

-- ---------- Check-in με QR (κάμερα) ή κάρτα NFC/RFID ----------
-- Προσωπικός κωδικός QR κάθε μέλους (δεν μαντεύεται)
alter table public.gym_members add column if not exists checkin_code text
  default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
update public.gym_members set checkin_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16) where checkin_code is null;
create unique index if not exists gym_members_checkin_code on public.gym_members (checkin_code);

create or replace function public.checkin(p_gym uuid, p_code text, p_method text default 'qr')
returns json language plpgsql security definer set search_path = public as $$
declare v_code text; m gym_members%rowtype; v_already boolean; s record;
begin
  if not public.is_gym_staff(p_gym) then raise exception 'Μόνο για το προσωπικό'; end if;
  v_code := regexp_replace(trim(coalesce(p_code, '')), '^OGYM:', '', 'i');
  select * into m from gym_members
  where gym_id = p_gym and status = 'active'
    and (checkin_code = v_code
         or upper(regexp_replace(rfid_tag, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(v_code, '[^A-Za-z0-9]', '', 'g')))
  limit 1;
  if m.id is null then raise exception 'Άγνωστος κωδικός ή κάρτα'; end if;
  v_already := exists (select 1 from attendance where member_id = m.id and checked_in_at::date = current_date);
  if not v_already then
    insert into attendance (gym_id, member_id, method)
    values (p_gym, m.id, case when p_method in ('qr','rfid','manual') then p_method else 'rfid' end);
  end if;
  select * into s from public.sub_status(p_gym) x where x.member_id = m.id;
  return json_build_object('member_id', m.id, 'name', m.full_name, 'already', v_already, 'is_athlete', m.is_athlete,
    'status', coalesce(s.status, 'none'), 'plan', s.plan_name, 'end_date', s.end_date, 'visits_left', s.visits_left);
end $$;
revoke execute on function public.checkin(uuid, text, text) from public, anon;
grant execute on function public.checkin(uuid, text, text) to authenticated;
