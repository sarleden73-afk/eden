-- Fidely — Migration 006 : notifications WhatsApp (log + idempotence)
-- SQL Editor > New query > Run
-- Sans effet tant que WHATSAPP_PHONE_NUMBER_ID/ACCESS_TOKEN ne sont pas configurés
-- (src/lib/whatsapp.ts n'écrit rien dans cette table dans ce cas).

create table if not exists whatsapp_notifications (
  id serial primary key,
  business_id integer not null references businesses(id),
  customer_id text not null references customers(id),
  type text not null, -- 'reward_unlocked' | 'tier_reached' | 'welcome_new_client' | 'inactive_reminder'
  reference_id text not null, -- clé anti-doublon, propre à chaque type (voir src/lib/whatsapp.ts)
  template_name text not null,
  payload jsonb,
  status text not null default 'pending', -- 'pending' | 'sent' | 'failed'
  provider_message_id text,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (customer_id, type, reference_id)
);

alter table whatsapp_notifications enable row level security;
