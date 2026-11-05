# --- !Ups
-- Values name the script that writes them, reveal-or-hide-regions.sh (#3860). RENAME VALUE relabels rows in place.
ALTER TYPE street_edge_status_change_source RENAME VALUE 'reveal_neighborhoods' TO 'reveal_regions';
ALTER TYPE street_edge_status_change_source RENAME VALUE 'hide_neighborhoods' TO 'hide_regions';

# --- !Downs
ALTER TYPE street_edge_status_change_source RENAME VALUE 'hide_regions' TO 'hide_neighborhoods';
ALTER TYPE street_edge_status_change_source RENAME VALUE 'reveal_regions' TO 'reveal_neighborhoods';
