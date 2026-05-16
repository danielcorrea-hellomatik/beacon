-- Beacon bridge schema (SQLite)
-- Storage: ~/.beacon/data.db
-- Retention: infinito (decisión del usuario)

create table if not exists sessions (
  id              text primary key,                   -- Claude Code session_id (uuid)
  cwd             text not null,                      -- proyecto / directorio
  status          text not null default 'unknown',    -- working | idle | needs_input | ended | unknown
  model           text default '',                    -- opus-4-7 / sonnet / haiku
  channel         text default '',                    -- terminal / sdk / api
  started_at      integer not null,                   -- ms epoch
  last_event_at   integer not null,                   -- ms epoch (para idle detection)
  ended_at        integer default null,
  prompt_first    text default '',                    -- primer prompt del user (para preview)
  tokens_in       integer default 0,
  tokens_out      integer default 0,
  events_count    integer default 0
);

create index if not exists idx_sessions_status on sessions( status );
create index if not exists idx_sessions_last_event on sessions( last_event_at );

create table if not exists events (
  id              integer primary key autoincrement,
  session_id      text not null,
  ts              integer not null,                   -- ms epoch
  type            text not null,                      -- SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | SubagentStop | Notification | Stop | SessionEnd
  tool_name       text default '',                    -- solo para PreToolUse / PostToolUse
  payload_json    text not null,                      -- raw stdin JSON del hook
  foreign key( session_id ) references sessions( id ) on delete cascade
);

create index if not exists idx_events_session_ts on events( session_id, ts desc );
create index if not exists idx_events_type on events( type );

create table if not exists queued_prompts (
  id              integer primary key autoincrement,
  session_id      text not null,
  prompt          text not null,
  queued_at       integer not null,
  delivered_at    integer default null,                -- ms epoch cuando se disparó claude --resume
  error           text default '',
  foreign key( session_id ) references sessions( id )
);

create index if not exists idx_queued_pending on queued_prompts( delivered_at, queued_at );

create table if not exists notifications_log (
  id              integer primary key autoincrement,
  session_id      text not null,
  ts              integer not null,
  kind            text not null,                       -- stop | needs_input | idle
  title           text not null,
  body            text not null,
  sent_to_ntfy    integer default 0                    -- 0/1
);

create table if not exists config (
  key             text primary key,
  value           text not null,
  updated_at      integer not null
);

create table if not exists active_spawns (
  session_id      text primary key,
  pid             integer not null,
  started_at      integer not null
);

create table if not exists pending_approvals (
  id              integer primary key autoincrement,
  session_id      text not null,
  ts              integer not null,
  question        text not null,                       -- lo que Claude está preguntando
  response        text default null,                   -- texto libre del user (o 'allow'/'deny')
  responded_at    integer default null
);
create index if not exists idx_approvals_pending on pending_approvals( responded_at, ts );
