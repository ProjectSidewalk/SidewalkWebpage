# --- !Ups
UPDATE street_edge
SET x1 = ST_X(ST_StartPoint(geom)),
    y1 = ST_Y(ST_StartPoint(geom)),
    x2 = ST_X(ST_EndPoint(geom)),
    y2 = ST_Y(ST_EndPoint(geom));

# --- !Downs
UPDATE street_edge
SET x1 = ST_X(ST_EndPoint(geom)),
    y1 = ST_Y(ST_EndPoint(geom)),
    x2 = ST_X(ST_StartPoint(geom)),
    y2 = ST_Y(ST_StartPoint(geom));