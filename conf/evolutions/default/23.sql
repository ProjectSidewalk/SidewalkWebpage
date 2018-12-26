# --- !Ups
DROP TABLE sidewalk_edge_sidewalk_node;
DROP TABLE sidewalk_edge_parent_edge;
DROP TABLE sidewalk_edge;
DROP TABLE sidewalk_node;
DROP TABLE street_edge_street_node;
DROP TABLE street_node;

# --- !Downs
CREATE TABLE street_node (
  street_node_id integer NOT NULL,
  geom public.geometry(Point,4326) NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  PRIMARY KEY (street_node_id)
);

CREATE TABLE street_edge_street_node (
  street_edge_id bigint NOT NULL,
  street_node_id bigint NOT NULL,
  street_edge_street_node_id integer DEFAULT nextval('street_edge_street_node_id_seq'::regclass) NOT NULL,
  PRIMARY KEY (street_edge_street_node_id),
  FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id),
  FOREIGN KEY (street_node_id) REFERENCES street_node(street_node_id)
);

CREATE TABLE sidewalk_node (
  id_0 integer NOT NULL,
  geom public.geometry(Point, 4326),
  lat double precision,
  way_ids character varying,
  lng double precision,
  sidewalk_node_id character varying,
  PRIMARY KEY (id_0)
);

CREATE TABLE sidewalk_edge (
  geom public.geometry(LineString, 4326),
  y1 double precision,
  x2 double precision,
  x1 double precision,
  sidewalk_edge_id integer NOT NULL,
  y2 double precision,
  way_type character varying,
  source integer,
  target integer,
  deleted boolean DEFAULT false,
  "timestamp" timestamp with time zone DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (sidewalk_edge_id),
  FOREIGN KEY (source) REFERENCES sidewalk_node(id_0),
  FOREIGN KEY (target) REFERENCES sidewalk_node(id_0)
);

CREATE TABLE sidewalk_edge_parent_edge (
  sidewalk_edge_id bigint NOT NULL,
  parent_edge_id bigint,
  FOREIGN KEY (sidewalk_edge_id) REFERENCES sidewalk_edge(sidewalk_edge_id),
  FOREIGN KEY (parent_edge_id) REFERENCES sidewalk_edge(sidewalk_edge_id)
);

CREATE TABLE sidewalk_edge_sidewalk_node (
  sidewalk_edge_id bigint NOT NULL,
  sidewalk_node_id bigint,
  FOREIGN KEY (sidewalk_edge_id) REFERENCES sidewalk_edge(sidewalk_edge_id),
  FOREIGN KEY (sidewalk_node_id) REFERENCES sidewalk_node(id_0)
);
