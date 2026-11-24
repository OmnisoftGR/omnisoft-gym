-- 17: Καμία λίστα αναμονής. Γεμάτη ώρα = δεν γίνεται κράτηση από αθλητή.
-- Οι παλιές εγγραφές αναμονής ακυρώνονται.

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
  -- Χωρίς λίστα αναμονής: ο αθλητής δεν κλείνει σε γεμάτη ώρα· το προσωπικό μπορεί να προσθέσει και πάνω από τις θέσεις
  if v_taken >= s.capacity and not v_staff then raise exception 'Η ώρα είναι γεμάτη'; end if;
  v_status := 'booked';
  insert into bookings (gym_id, session_id, member_id, status)
  values (s.gym_id, p_session, v_member, v_status)
  on conflict (session_id, member_id) do update
    set status = case when bookings.status in ('booked','attended') then bookings.status else excluded.status end,
        updated_at = now()
  returning id, status into v_id, v_status;
  return json_build_object('booking_id', v_id, 'status', v_status);
end $$;

update public.bookings set status = 'cancelled', updated_at = now() where status = 'waitlist';
