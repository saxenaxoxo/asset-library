-- Search index keyed by a stable integer per asset. The first index stored asset IDs in an
-- unindexed column, so every update had to scan the whole index to remove the old row.
alter table assets add column search_id integer;
update assets set search_id = rowid;
create unique index assets_search_id on assets (search_id);

drop table assets_fts;
create virtual table assets_fts using fts5(filename, rel_path, tags, tokenize = 'trigram');
insert into assets_fts (rowid, filename, rel_path, tags)
  select a.search_id, a.filename, a.rel_path,
    coalesce((select group_concat(t.name, ' ') from asset_tags at join tags t on t.id = at.tag_id
      where at.asset_id = a.id), '')
  from assets a;

-- Root listings check for a running scan on every call.
create index scans_root_state on scans (root_id, state);
