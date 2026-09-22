create table if not exists public.tonewright_budget (
  id int primary key,
  total_cents numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint tonewright_budget_singleton check (id = 1)
);

insert into public.tonewright_budget (id, total_cents)
values (1, 0)
on conflict (id) do nothing;

alter table public.tonewright_budget enable row level security;

create or replace function public.tonewright_increment_budget(delta numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_total numeric;
begin
  update public.tonewright_budget
  set total_cents = total_cents + delta,
      updated_at = now()
  where id = 1
  returning total_cents into new_total;
  return new_total;
end;
$$;
