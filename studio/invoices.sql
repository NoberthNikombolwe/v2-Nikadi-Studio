-- Finance: Invoices table
-- Run in Supabase SQL editor: Dashboard → SQL Editor → New query → paste → Run

create table if not exists invoices (
  id             uuid        primary key default gen_random_uuid(),
  invoice_no     text        not null,
  event_id       uuid        references events(id) on delete set null,
  status         text        not null default 'draft',      -- draft | sent | paid
  issue_date     date        not null,
  due_date       date        not null,
  client_name    text,
  client_email   text,
  client_phone   text,
  client_address text,
  items          jsonb       not null default '[]'::jsonb,
  vat_enabled    boolean     not null default false,
  vat_type       text        not null default 'exclusive',  -- exclusive | inclusive
  discount       numeric     not null default 0,
  notes          text,
  sub            numeric     not null default 0,
  vat_amount     numeric     not null default 0,
  grand          numeric     not null default 0,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table invoices enable row level security;

-- Active users can view and manage invoices
create policy "invoices_all" on invoices for all
  using  (is_active_user())
  with check (is_active_user());

-- Only Super Admins can delete (matches all other finance tables)
create policy "invoices_delete_super_admin" on invoices as restrictive for delete
  using (public.my_role() = 'superuser');
