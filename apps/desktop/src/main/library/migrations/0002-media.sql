-- Generated media (thumbnails, hover-scrub sprites, previews, waveforms) for each asset.
-- File names are relative to the app's media cache folder; NULL means "not available".
alter table assets add column media_state text not null default 'pending'
  check (media_state in ('pending', 'done', 'error'));
alter table assets add column media_key text;
alter table assets add column thumb_file text;
alter table assets add column sprite_file text;
alter table assets add column preview_file text;
alter table assets add column wave_file text;
create index assets_media on assets (media_state);
