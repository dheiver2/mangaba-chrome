-- Banco da extensão Mangaba AI: contas e dados sincronizados por usuário.
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null default '',
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- Um documento JSON por usuário e tipo: 'settings', 'chat', 'agent', 'memory'.
create table if not exists user_data (
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

-- Tentativas de login/cadastro por IP, para o limite valer entre instâncias serverless.
create table if not exists auth_tentativas (
  ip text not null,
  ts timestamptz not null default now()
);
create index if not exists auth_tentativas_ip_ts on auth_tentativas (ip, ts);
