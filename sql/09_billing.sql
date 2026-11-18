-- Omnisoft Gym — 9: χρέωση εφαρμογής = ελάχιστη μηνιαία χρέωση + ανά ενεργό αθλητή
-- Ενεργός αθλητής μήνα: έκανε τουλάχιστον ένα check-in ή μία καταγεγραμμένη προπόνηση μέσα στον μήνα.
-- Ποσό = ελάχιστη χρέωση + (ενεργοί − αθλητές που περιλαμβάνονται) × τιμή ανά αθλητή. Δοκιμαστικό/Δωρεάν = 0.

alter table public.platform_settings add column if not exists bill_min_fee numeric(8,2) not null default 19;
alter table public.platform_settings add column if not exists bill_included int not null default 25;
alter table public.platform_settings add column if not exists bill_per_athlete numeric(6,2) not null default 0.60;

-- Ειδική τιμή ανά γυμναστήριο (κενό = τιμή πλατφόρμας)
alter table public.gyms add column if not exists bill_min_fee numeric(8,2);
alter table public.gyms add column if not exists bill_included int;
alter table public.gyms add column if not exists bill_per_athlete numeric(6,2);

-- Ο ιδιοκτήτης δεν αλλάζει έγκριση/πακέτο/όρια/χρέωση
create or replace function public.tg_gym_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_admin()
     and (new.status is distinct from old.status or new.approved_at is distinct from old.approved_at
          or new.plan is distinct from old.plan or new.max_athletes is distinct from old.max_athletes
          or new.paid_until is distinct from old.paid_until or new.admin_notes is distinct from old.admin_notes
          or new.bill_min_fee is distinct from old.bill_min_fee or new.bill_included is distinct from old.bill_included
          or new.bill_per_athlete is distinct from old.bill_per_athlete) then
    raise exception 'Αυτά τα στοιχεία αλλάζουν μόνο από τη διαχείριση';
  end if;
  return new;
end $$;

-- Χρέωση μήνα: ο διαχειριστής βλέπει όλα τα γυμναστήρια, ο ιδιοκτήτης μόνο το δικό του
create or replace function public.billing_month(p_month date, p_gym uuid default null)
returns table (gym_id uuid, gym_name text, plan text, status text, month date, active_athletes int,
               min_fee numeric, included int, per_athlete numeric, extra_athletes int, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_month)::date; v_to date := (date_trunc('month', p_month) + interval '1 month')::date;
        ps platform_settings%rowtype; v_admin boolean := public.is_platform_admin();
begin
  if not v_admin and (p_gym is null or not public.is_gym_owner(p_gym)) then raise exception 'Χωρίς πρόσβαση'; end if;
  select * into ps from platform_settings where id = 1;
  return query
  with act as (
    select m.gym_id, count(distinct m.id)::int n
    from gym_members m
    where m.is_athlete and (p_gym is null or m.gym_id = p_gym)
      and (exists (select 1 from attendance a where a.member_id = m.id
                     and a.checked_in_at >= v_from and a.checked_in_at < v_to)
        or exists (select 1 from workout_sessions w where w.athlete_id = m.id
                     and w.performed_on >= v_from and w.performed_on < v_to))
    group by m.gym_id)
  select g.id, g.name, g.plan, g.status, v_from, coalesce(a.n, 0),
         coalesce(g.bill_min_fee, ps.bill_min_fee), coalesce(g.bill_included, ps.bill_included),
         coalesce(g.bill_per_athlete, ps.bill_per_athlete),
         greatest(0, coalesce(a.n, 0) - coalesce(g.bill_included, ps.bill_included)),
         case when g.plan in ('trial', 'free') then 0::numeric
              else round(coalesce(g.bill_min_fee, ps.bill_min_fee)
                   + greatest(0, coalesce(a.n, 0) - coalesce(g.bill_included, ps.bill_included)) * coalesce(g.bill_per_athlete, ps.bill_per_athlete), 2) end
  from gyms g left join act a on a.gym_id = g.id
  where (p_gym is null or g.id = p_gym) and g.status <> 'pending'
  order by g.name;
end $$;
revoke execute on function public.billing_month(date, uuid) from public, anon;
grant execute on function public.billing_month(date, uuid) to authenticated;
