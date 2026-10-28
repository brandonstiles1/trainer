-- ============================================
-- Row Level Security — each user sees only their own rows.
-- Apply once after running Drizzle migrations.
-- ============================================

alter table public.profiles        enable row level security;
alter table public.goals           enable row level security;
alter table public.plans           enable row level security;
alter table public.lift_estimates  enable row level security;
alter table public.workouts        enable row level security;
alter table public.workout_sets    enable row level security;
alter table public.photos          enable row level security;

-- ---------- profiles ----------
create policy "profiles: user reads own"
  on public.profiles for select using (user_id = auth.uid());
create policy "profiles: user updates own"
  on public.profiles for update using (user_id = auth.uid());

-- ---------- goals ----------
create policy "goals: user owns"
  on public.goals for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- plans ----------
create policy "plans: user owns"
  on public.plans for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- lift_estimates ----------
create policy "lift_estimates: user owns"
  on public.lift_estimates for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- workouts ----------
create policy "workouts: user owns"
  on public.workouts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- workout_sets ----------
-- No user_id column; access via parent workout.
create policy "workout_sets: user owns via workout"
  on public.workout_sets for all
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_sets.workout_id
        and w.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workouts w
      where w.id = workout_sets.workout_id
        and w.user_id = auth.uid()
    )
  );

-- ---------- photos ----------
create policy "photos: user owns"
  on public.photos for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================
-- ---------- exercise_preferences ----------
alter table public.exercise_preferences enable row level security;
create policy "exercise_preferences: user owns"
  on public.exercise_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- weekly_reviews ----------
alter table public.weekly_reviews enable row level security;
create policy "weekly_reviews: user owns"
  on public.weekly_reviews for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Auto-create profile row on auth.users insert.
-- ============================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- body_weights ----------
alter table public.body_weights enable row level security;
create policy "body_weights: user owns"
  on public.body_weights for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
