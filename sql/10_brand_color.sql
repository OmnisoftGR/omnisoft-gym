-- Omnisoft Gym — 10: το χρώμα της εφαρμογής ανά γυμναστήριο το αλλάζει μόνο η διαχείριση πλατφόρμας
create or replace function public.tg_gym_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_admin()
     and (new.status is distinct from old.status or new.approved_at is distinct from old.approved_at
          or new.plan is distinct from old.plan or new.max_athletes is distinct from old.max_athletes
          or new.paid_until is distinct from old.paid_until or new.admin_notes is distinct from old.admin_notes
          or new.bill_min_fee is distinct from old.bill_min_fee or new.bill_included is distinct from old.bill_included
          or new.bill_per_athlete is distinct from old.bill_per_athlete
          or new.primary_color is distinct from old.primary_color or new.secondary_color is distinct from old.secondary_color) then
    raise exception 'Αυτά τα στοιχεία αλλάζουν μόνο από τη διαχείριση';
  end if;
  return new;
end $$;
