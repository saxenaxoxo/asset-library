create table roots (
  id integer primary key,
  path text not null unique,
  label text not null,
  status text not null default 'ok' check (status in ('ok', 'offline')),
  added_at integer not null,
  last_scan_at integer
);

create table exclusions (
  id integer primary key,
  root_id integer not null references roots(id) on delete cascade,
  rel_path text not null,
  unique (root_id, rel_path)
);

create table assets (
  id text primary key,
  root_id integer not null references roots(id) on delete cascade,
  rel_path text not null,
  filename text not null,
  ext text not null,
  kind text not null check (kind in ('video', 'audio', 'image', 'template')),
  size integer not null,
  mtime integer not null,
  fingerprint text,
  width integer,
  height integer,
  duration_ms integer,
  fps real,
  codec text,
  has_alpha integer,
  channels integer,
  sample_rate integer,
  probe_state text not null default 'pending' check (probe_state in ('pending', 'done', 'error')),
  status text not null default 'ok' check (status in ('ok', 'missing', 'error')),
  error_msg text,
  favorite integer not null default 0,
  notes text,
  added_at integer not null,
  indexed_at integer not null,
  last_seen_scan integer not null,
  unique (root_id, rel_path)
);
create index assets_kind on assets (kind);
create index assets_added on assets (added_at);
create index assets_fingerprint on assets (fingerprint);
create index assets_probe on assets (probe_state);

create table tags (
  id integer primary key,
  name text not null unique collate nocase
);

create table asset_tags (
  asset_id text not null references assets(id) on delete cascade,
  tag_id integer not null references tags(id) on delete cascade,
  primary key (asset_id, tag_id)
);

create table scans (
  id integer primary key,
  root_id integer not null references roots(id) on delete cascade,
  started_at integer not null,
  finished_at integer,
  state text not null check (state in ('running', 'done', 'aborted')),
  files_seen integer not null default 0
);

create virtual table assets_fts using fts5(
  asset_id unindexed, filename, rel_path, tags, tokenize = 'trigram'
);
