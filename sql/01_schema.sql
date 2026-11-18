-- =====================================================================
-- Omnisoft Gym — σχήμα βάσης (multi-tenant)
-- Ρόλοι ανά γυμναστήριο: ιδιοκτήτης, προπονητής, αθλητής (ένας χρήστης μπορεί να έχει πολλούς)
-- =====================================================================

-- ---------- Πλατφόρμα ----------
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  primary_color text not null default '#d71920',
  secondary_color text not null default '#111111',
  logo_url text,
  city text,
  phone text,
  created_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Μέλη γυμναστηρίου (ιδιοκτήτες, προπονητές, αθλητές) ----------
create table public.gym_members (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,   -- συνδέεται αυτόματα με το email
  email text not null,
  full_name text not null,
  phone text,
  is_owner boolean not null default false,
  is_coach boolean not null default false,
  is_athlete boolean not null default false,
  coach_id uuid references public.gym_members(id) on delete set null, -- υπεύθυνος προπονητής αθλητή
  birth_year int,
  goal text,
  notes text,
  rfid_tag text,                      -- για μελλοντικό USB RFID reader
  status text not null default 'active' check (status in ('active','inactive')),
  joined_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (gym_id, email),
  unique (gym_id, rfid_tag)
);
create index on public.gym_members (user_id);
create index on public.gym_members (lower(email));

-- ---------- Βιβλιοθήκη ασκήσεων (κοινή για όλα τα γυμναστήρια, με stickman animation) ----------
create table public.exercise_library (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                 -- και κλειδί του SVG animation
  name_el text not null,
  name_en text,
  muscle_group text not null,
  equipment_type text not null,              -- π.χ. barbell, dumbbell, machine_leg_press, bodyweight
  metric_type text not null default 'reps_weight'
    check (metric_type in ('reps_weight','reps','time','distance')),
  default_increment_kg numeric(5,2) not null default 2.5,
  cues text
);

-- ---------- Εξοπλισμός γυμναστηρίου (από φωτογραφίες) ----------
create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  name text not null,
  equipment_type text,
  photo_path text,                           -- Supabase Storage
  ai_detected boolean not null default false,
  ai_confidence numeric(4,3),
  created_at timestamptz not null default now()
);

-- ---------- Ασκήσεις γυμναστηρίου ----------
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  library_id uuid references public.exercise_library(id),
  equipment_id uuid references public.equipment(id) on delete set null,
  name text not null,
  muscle_group text,
  metric_type text not null default 'reps_weight'
    check (metric_type in ('reps_weight','reps','time','distance')),
  animation_code text,                       -- = exercise_library.code
  increment_kg numeric(5,2) not null default 2.5,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (gym_id, name)
);

-- ---------- Προγράμματα ----------
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  athlete_id uuid references public.gym_members(id) on delete cascade, -- null = πρότυπο
  coach_id uuid references public.gym_members(id) on delete set null,
  name text not null,
  goal text,
  is_template boolean not null default false,
  sessions_per_week int not null default 3 check (sessions_per_week between 1 and 7),
  start_date date not null default current_date,
  end_date date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  check (is_template or athlete_id is not null)
);
create index on public.programs (athlete_id) where active;

create table public.program_days (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  day_no int not null,
  name text not null,                        -- π.χ. «Ημέρα Α – Πόδια»
  unique (program_id, day_no)
);

create table public.program_exercises (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  program_day_id uuid not null references public.program_days(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  sort_order int not null default 1,
  sets int not null default 3,
  reps_min int,                              -- εύρος στόχου, π.χ. 8–12
  reps_max int,
  target_weight numeric(6,2),
  target_seconds int,
  target_rpe numeric(3,1),
  rest_seconds int default 90,
  increment_kg numeric(5,2),                 -- null = της άσκησης
  notes text
);
create index on public.program_exercises (program_day_id);

-- ---------- Καταγραφή προπονήσεων ----------
create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  athlete_id uuid not null references public.gym_members(id) on delete cascade,
  program_day_id uuid references public.program_days(id) on delete set null,
  performed_on date not null default current_date,
  source text not null default 'athlete' check (source in ('athlete','coach','tablet')),
  session_rpe numeric(3,1),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.workout_sessions (athlete_id, performed_on desc);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  program_exercise_id uuid references public.program_exercises(id) on delete set null,
  exercise_id uuid not null references public.exercises(id),
  set_no int not null,
  reps int,
  weight numeric(6,2),
  seconds int,
  rpe numeric(3,1),
  created_at timestamptz not null default now()
);
create index on public.workout_sets (session_id);
create index on public.workout_sets (exercise_id);

-- ---------- Παρουσίες ----------
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms(id) on delete cascade,
  member_id uuid not null references public.gym_members(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  method text not null default 'manual' check (method in ('manual','rfid','qr','workout')),
  recorded_by uuid default auth.uid()
);
create index on public.attendance (member_id, checked_in_at desc);

-- ---------- Ρυθμίσεις progression ανά γυμναστήριο ----------
create table public.progression_settings (
  gym_id uuid primary key references public.gyms(id) on delete cascade,
  missed_days_hold int not null default 10,     -- απουσία > Χ ημέρες: κρατάμε τα κιλά
  missed_days_deload int not null default 21,   -- απουσία > Χ ημέρες: μείωση
  deload_pct numeric(4,1) not null default 10,  -- % μείωσης μετά από απουσία
  max_rpe_for_increase numeric(3,1) not null default 8.5,
  fails_for_decrease int not null default 2,    -- διαδοχικές αποτυχίες κάτω από reps_min
  decrease_pct numeric(4,1) not null default 5,
  stall_sessions int not null default 4         -- χωρίς βελτίωση σε Χ προπονήσεις = «κόλλημα»
);
