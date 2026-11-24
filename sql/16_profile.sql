-- 16: Τα στοιχεία μου (αθλητής) — ύψος, σχόλια αθλητή, ιστορικό βάρους
-- Ο αθλητής αλλάζει μόνο τα δικά του πεδία, μέσω της update_my_profile.

alter table public.gym_members add column if not exists height_cm int check (height_cm between 80 and 250);
alter table public.gym_members add column if not exists athlete_notes text;   -- σχόλια του αθλητή (τα βλέπει και ο προπονητής)

-- ---------- Ιστορικό βάρους ----------
create table if not exists public.body_weights (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  measured_on date not null default current_date,
  weight_kg numeric(5,1) not null check (weight_kg between 20 and 400),
  created_at timestamptz not null default now()
);
create index if not exists body_weights_member on public.body_weights (member_id, measured_on desc);

create or replace function public.tg_bw_gym() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select gym_id into new.gym_id from gym_members where id = new.member_id;
  return new;
end $$;
drop trigger if exists trg_a_gym on public.body_weights;
create trigger trg_a_gym before insert or update on public.body_weights
  for each row execute function public.tg_bw_gym();

alter table public.body_weights enable row level security;
drop policy if exists bw_select on public.body_weights;
drop policy if exists bw_write on public.body_weights;
create policy bw_select on public.body_weights for select to authenticated
  using (public.is_gym_staff(gym_id) or public.is_me(member_id));
create policy bw_write on public.body_weights for all to authenticated
  using (public.is_gym_staff(gym_id) or public.is_me(member_id))
  with check (public.is_gym_staff(gym_id) or public.is_me(member_id));
grant select, insert, update, delete on public.body_weights to authenticated;

-- ---------- Ο αθλητής ενημερώνει τα στοιχεία του ----------
create or replace function public.update_my_profile(p_member uuid, p_full_name text, p_phone text, p_birth_year int,
  p_height_cm int, p_goal text, p_athlete_notes text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_me(p_member) then raise exception 'not allowed'; end if;
  update gym_members set
    full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
    phone = nullif(trim(p_phone), ''),
    birth_year = p_birth_year,
    height_cm = p_height_cm,
    goal = nullif(trim(p_goal), ''),
    athlete_notes = nullif(trim(p_athlete_notes), '')
  where id = p_member;
end $$;
revoke all on function public.update_my_profile(uuid, text, text, int, int, text, text) from public;
grant execute on function public.update_my_profile(uuid, text, text, int, int, text, text) to authenticated;
