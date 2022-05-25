# --- !Ups
UPDATE tag SET tag = 'brick/cobblestone' WHERE tag = 'brick';

# --- !Downs
UPDATE tag SET tag = 'brick' WHERE tag = 'brick/cobblestone';
