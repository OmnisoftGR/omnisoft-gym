-- =====================================================================
-- Omnisoft Gym — βιβλιοθήκη ασκήσεων + demo δεδομένα
-- =====================================================================

insert into public.exercise_library (code, name_el, name_en, muscle_group, equipment_type, metric_type, default_increment_kg) values
('squat_barbell','Βαθύ κάθισμα με μπάρα','Barbell squat','Πόδια','barbell','reps_weight',2.5),
('goblet_squat','Goblet squat','Goblet squat','Πόδια','kettlebell','reps_weight',2),
('leg_press','Πρέσα ποδιών','Leg press','Πόδια','machine_leg_press','reps_weight',5),
('leg_extension','Εκτάσεις ποδιών','Leg extension','Πόδια','machine_leg_extension','reps_weight',2.5),
('leg_curl','Κάμψεις ποδιών','Leg curl','Πόδια','machine_leg_curl','reps_weight',2.5),
('lunge_dumbbell','Προβολές με αλτήρες','Dumbbell lunge','Πόδια','dumbbell','reps_weight',2),
('romanian_deadlift','Ρουμανικές άρσεις','Romanian deadlift','Πόδια','barbell','reps_weight',2.5),
('hip_thrust','Hip thrust','Hip thrust','Γλουτοί','barbell','reps_weight',5),
('calf_raise','Άνοδοι γαστροκνημίων','Calf raise','Γάμπες','machine_calf','reps_weight',5),
('box_jump','Άλματα σε κουτί','Box jump','Πόδια','plyo_box','reps',0),
('deadlift','Άρση θανάτου','Deadlift','Πλάτη','barbell','reps_weight',5),
('lat_pulldown','Έλξεις τροχαλίας','Lat pulldown','Πλάτη','machine_lat_pulldown','reps_weight',5),
('seated_row','Κωπηλατική καθιστή','Seated cable row','Πλάτη','cable_row','reps_weight',5),
('db_row','Κωπηλατική με αλτήρα','Dumbbell row','Πλάτη','dumbbell','reps_weight',2),
('pull_up','Έλξεις μονόζυγου','Pull-up','Πλάτη','pull_up_bar','reps',0),
('bench_press','Πιέσεις πάγκου με μπάρα','Bench press','Στήθος','barbell','reps_weight',2.5),
('incline_db_press','Πιέσεις κεκλιμένου με αλτήρες','Incline dumbbell press','Στήθος','dumbbell','reps_weight',2),
('chest_press_machine','Πιέσεις στήθους σε μηχάνημα','Machine chest press','Στήθος','machine_chest_press','reps_weight',5),
('pec_fly_machine','Πεταλούδα','Pec deck fly','Στήθος','machine_pec_deck','reps_weight',2.5),
('push_up','Κάμψεις (push-ups)','Push-up','Στήθος','bodyweight','reps',0),
('overhead_press','Πιέσεις ώμων με μπάρα','Overhead press','Ώμοι','barbell','reps_weight',2.5),
('db_shoulder_press','Πιέσεις ώμων με αλτήρες','Dumbbell shoulder press','Ώμοι','dumbbell','reps_weight',2),
('lateral_raise','Πλάγιες εκτάσεις','Lateral raise','Ώμοι','dumbbell','reps_weight',1),
('face_pull','Face pull','Face pull','Ώμοι','cable','reps_weight',2.5),
('biceps_curl','Κάμψεις δικεφάλων','Biceps curl','Χέρια','dumbbell','reps_weight',1),
('triceps_pushdown','Εκτάσεις τρικεφάλων στην τροχαλία','Triceps pushdown','Χέρια','cable','reps_weight',2.5),
('dips','Βυθίσεις','Dips','Χέρια','dip_station','reps',0),
('plank','Σανίδα','Plank','Κορμός','bodyweight','time',0),
('crunch','Κοιλιακοί','Crunch','Κορμός','bodyweight','reps',0),
('russian_twist','Ρωσικές περιστροφές','Russian twist','Κορμός','bodyweight','reps',0),
('kettlebell_swing','Αιωρήσεις kettlebell','Kettlebell swing','Ολόσωμη','kettlebell','reps_weight',4),
('farmer_walk','Μεταφορά αγρότη','Farmer walk','Ολόσωμη','dumbbell','reps_weight',2),
('burpee','Burpees','Burpee','Ολόσωμη','bodyweight','reps',0),
('jump_rope','Σχοινάκι','Jump rope','Αερόβια','jump_rope','time',0),
('heavy_bag','Σάκος (γύροι)','Heavy bag rounds','Πολεμικά','heavy_bag','time',0),
('shadow_boxing','Σκιαμαχία','Shadow boxing','Πολεμικά','bodyweight','time',0),
('rowing_machine','Κωπηλατικό εργόμετρο','Rowing machine','Αερόβια','rower','distance',0),
('treadmill','Διάδρομος','Treadmill','Αερόβια','treadmill','time',0);

do $$
declare
  g1 uuid; g2 uuid; coach uuid; coach2 uuid; a record; prog uuid; d uuid; pe record;
  dt date; k int; v_day int; sess uuid; w numeric; reps int; cnt int; last_n int;
  eq_rack uuid; eq_press uuid; eq_cable uuid; eq_bag uuid;
begin
  -- Γυμναστήρια (demo χρώματα)
  insert into gyms (name, status, primary_color, secondary_color, city, approved_at)
    values ('Demo Fight Club', 'active', '#d71920', '#111111', 'Demo πόλη', now()) returning id into g1;
  insert into gyms (name, status, primary_color, secondary_color, city, approved_at)
    values ('Iron Box (demo)', 'active', '#1f6feb', '#0d1117', 'Demo πόλη', now()) returning id into g2;

  -- Προσωπικό
  insert into gym_members (gym_id, email, full_name, is_owner, is_coach)
    values (g1, 'coach@demo.gym', 'Προπονητής Demo', true, true) returning id into coach;
  insert into gym_members (gym_id, email, full_name, is_owner, is_coach)
    values (g2, 'owner@ironbox.demo', 'Ιδιοκτήτης Iron Box', true, true) returning id into coach2;
  insert into gym_members (gym_id, email, full_name, is_athlete, coach_id, goal)
    values (g2, 'athlete@ironbox.demo', 'Αθλητής Iron Box', true, coach2, 'Δύναμη');

  -- Εξοπλισμός (σαν να βγήκε από φωτογραφίες)
  insert into equipment (gym_id, name, equipment_type, ai_detected, ai_confidence) values
    (g1,'Κλωβός squat με μπάρα','barbell',true,0.94) returning id into eq_rack;
  insert into equipment (gym_id, name, equipment_type, ai_detected, ai_confidence) values
    (g1,'Πρέσα ποδιών 45°','machine_leg_press',true,0.91) returning id into eq_press;
  insert into equipment (gym_id, name, equipment_type, ai_detected, ai_confidence) values
    (g1,'Διπλή τροχαλία','cable',true,0.88) returning id into eq_cable;
  insert into equipment (gym_id, name, equipment_type, ai_detected, ai_confidence) values
    (g1,'Σάκοι πυγμαχίας','heavy_bag',true,0.97) returning id into eq_bag;
  insert into equipment (gym_id, name, equipment_type) values
    (g1,'Αλτήρες 2–30 κ.','dumbbell'), (g1,'Kettlebells','kettlebell'), (g1,'Πάγκος','bench'),
    (g1,'Μηχάνημα έλξεων τροχαλίας','machine_lat_pulldown'), (g1,'Μηχάνημα κάμψεων ποδιών','machine_leg_curl');

  -- Ασκήσεις γυμναστηρίων από τη βιβλιοθήκη
  insert into exercises (gym_id, library_id, name, muscle_group, metric_type, animation_code, increment_kg, equipment_id)
  select g1, l.id, l.name_el, l.muscle_group, l.metric_type, l.code, l.default_increment_kg,
         case l.equipment_type when 'barbell' then eq_rack when 'machine_leg_press' then eq_press
              when 'cable' then eq_cable when 'cable_row' then eq_cable when 'heavy_bag' then eq_bag end
  from exercise_library l;
  insert into exercises (gym_id, library_id, name, muscle_group, metric_type, animation_code, increment_kg)
  select g2, l.id, l.name_el, l.muscle_group, l.metric_type, l.code, l.default_increment_kg
  from exercise_library l where l.equipment_type in ('barbell','dumbbell','bodyweight');

  -- Πρότυπο προγράμματος 3 ημερών
  insert into programs (gym_id, coach_id, name, goal, is_template, sessions_per_week)
    values (g1, coach, 'Πρότυπο: Γενική δύναμη 3 ημέρες', 'Δύναμη / φυσική κατάσταση', true, 3);

  -- Αθλητές με διαφορετικά σενάρια
  for a in
    select * from (values
      ('nikos@demo.gym',  'Νίκος Παπαδάκης',     'steady',  1.20, 'Μυϊκή μάζα'),
      ('maria@demo.gym',  'Μαρία Σφακιανάκη',    'absent',  0.60, 'Τόνωση'),
      ('kostas@demo.gym', 'Κώστας Μαρκάκης',     'stall',   1.00, 'Δύναμη'),
      ('eleni@demo.gym',  'Ελένη Τσαγκαράκη',    'failing', 0.70, 'Φυσική κατάσταση'),
      ('giannis@demo.gym','Γιάννης Κουνάλης',    'new',     0.90, 'Απώλεια βάρους'),
      ('sofia@demo.gym',  'Σοφία Δασκαλάκη',     'hold',    0.65, 'Kickboxing προετοιμασία')
    ) v(email, full_name, scenario, factor, goal)
  loop
    insert into gym_members (gym_id, email, full_name, is_athlete, coach_id, goal, joined_on)
      values (g1, a.email, a.full_name, true, coach, a.goal, current_date - 80);

    insert into programs (gym_id, athlete_id, coach_id, name, goal, sessions_per_week, start_date)
      select g1, m.id, coach, 'Πρόγραμμα φθινοπώρου', a.goal, 3, current_date - 72
      from gym_members m where m.gym_id = g1 and m.email = a.email
      returning id into prog;

    -- Ημέρες και ασκήσεις
    for v_day in 1..3 loop
      insert into program_days (program_id, day_no, name)
        values (prog, v_day, (array['Ημέρα Α – Πόδια & κορμός','Ημέρα Β – Ώθηση','Ημέρα Γ – Έλξη & kettlebell'])[v_day])
        returning id into d;
      insert into program_exercises (program_day_id, exercise_id, sort_order, sets, reps_min, reps_max, target_weight, target_seconds, rest_seconds)
      select d, e.id, x.ord, x.sets, x.rmin, x.rmax,
             case when x.base is null then null else round(x.base * a.factor * 2) / 2 end, x.secs, x.rest
      from (values
        (1,'squat_barbell',1,3,8,10,60,null,120),(1,'leg_press',2,3,10,12,100,null,90),
        (1,'leg_curl',3,3,10,12,35,null,75),(1,'plank',4,3,null,null,null,45,45),
        (2,'bench_press',1,3,8,10,50,null,120),(2,'db_shoulder_press',2,3,8,12,14,null,90),
        (2,'triceps_pushdown',3,3,10,12,25,null,60),(2,'push_up',4,3,10,15,null,null,60),
        (3,'lat_pulldown',1,3,8,10,50,null,90),(3,'seated_row',2,3,10,12,45,null,90),
        (3,'biceps_curl',3,3,10,12,10,null,60),(3,'kettlebell_swing',4,3,12,15,16,null,60)
      ) x(dno, code, ord, sets, rmin, rmax, base, secs, rest)
      join exercises e on e.gym_id = g1 and e.animation_code = x.code
      where x.dno = v_day;
    end loop;

    if a.scenario = 'new' then continue; end if;

    -- Ιστορικό: Δευτέρα/Τετάρτη/Παρασκευή των τελευταίων 10 εβδομάδων
    k := 0;
    select count(*) into last_n from generate_series(current_date - 70, current_date - 1, '1 day') s(x)
      where extract(isodow from x) in (1,3,5);
    cnt := 0;
    for dt in select x::date from generate_series(current_date - 70, current_date - 1, '1 day') s(x)
              where extract(isodow from x) in (1,3,5) order by x
    loop
      cnt := cnt + 1;
      continue when a.scenario = 'absent' and dt > current_date - 26;
      continue when a.scenario = 'hold'   and dt > current_date - 14;
      continue when a.scenario = 'steady' and (extract(doy from dt)::int % 10) = 3;  -- ~10% απουσίες
      continue when a.scenario = 'stall'  and (extract(doy from dt)::int % 7) = 2;

      v_day := (k % 3) + 1;
      insert into workout_sessions (athlete_id, program_day_id, performed_on, source, session_rpe)
        select m.id, pd.id, dt, case when k % 4 = 0 then 'coach' else 'athlete' end,
               case a.scenario when 'stall' then 9 when 'failing' then 9.5 else 7.5 end
        from gym_members m, program_days pd
        where m.gym_id = g1 and m.email = a.email and pd.program_id = prog and pd.day_no = v_day
        returning id into sess;

      for pe in
        select p.*, e.metric_type, e.increment_kg as inc
        from program_exercises p join program_days pd on pd.id = p.program_day_id
        join exercises e on e.id = p.exercise_id
        where pd.program_id = prog and pd.day_no = v_day
      loop
        -- πόσες φορές έχει γίνει ήδη αυτή η ημέρα
        declare n int := k / 3;
        begin
          if pe.metric_type = 'reps_weight' then
            if a.scenario = 'stall' then
              w := pe.target_weight; reps := pe.reps_min;
            elsif a.scenario = 'failing' and cnt > last_n - 8 then
              w := pe.target_weight + (n / 2 + 2) * pe.inc; reps := pe.reps_min - 2;
            else
              w := pe.target_weight + (n / 2) * pe.inc;
              reps := case when n % 2 = 1 then pe.reps_max else pe.reps_min + 1 end;
            end if;
            insert into workout_sets (session_id, program_exercise_id, exercise_id, set_no, reps, weight, rpe)
            select sess, pe.id, pe.exercise_id, s, reps - case when s = 3 and a.scenario <> 'stall' and n % 2 = 0 then 1 else 0 end, w,
                   case a.scenario when 'stall' then 9 when 'failing' then 9.5 else 7 + s * 0.5 end
            from generate_series(1, pe.sets) s;
          elsif pe.metric_type = 'reps' then
            insert into workout_sets (session_id, program_exercise_id, exercise_id, set_no, reps, rpe)
            select sess, pe.id, pe.exercise_id, s, least(pe.reps_max, pe.reps_min + n / 2) , 8
            from generate_series(1, pe.sets) s;
          else
            insert into workout_sets (session_id, program_exercise_id, exercise_id, set_no, seconds, rpe)
            select sess, pe.id, pe.exercise_id, s, coalesce(pe.target_seconds, 30) + n * 5, 8
            from generate_series(1, pe.sets) s;
          end if;
        end;
      end loop;
      k := k + 1;
    end loop;
  end loop;
end $$;
