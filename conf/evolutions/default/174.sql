# --- !Ups
CREATE TABLE route
(
    route_id SERIAL NOT NULL,
    user_id TEXT NOT NULL,
    region_id INT NOT NULL,
    name TEXT NOT NULL,
    public BOOLEAN NOT NULL,
    deleted BOOLEAN NOT NULL,
    PRIMARY KEY (route_id),
    FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id),
    FOREIGN KEY (region_id) REFERENCES region(region_id)
);

CREATE TABLE route_street
(
    route_street_id SERIAL NOT NULL,
    route_id INT NOT NULL,
    street_edge_id INT NOT NULL,
    first_street BOOLEAN NOT NULL,
    PRIMARY KEY (route_street_id),
    FOREIGN KEY (route_id) REFERENCES route(route_id),
    FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id)
);

CREATE TABLE user_route
(
    user_route_id SERIAL NOT NULL,
    route_id INT NOT NULL,
    user_id TEXT NOT NULL,
    completed BOOLEAN NOT NULL,
    discarded BOOLEAN NOT NULL,
    PRIMARY KEY (user_route_id),
    FOREIGN KEY (route_id) REFERENCES route(route_id),
    FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id)
);

CREATE TABLE audit_task_user_route
(
    audit_task_user_route_id SERIAL NOT NULL,
    user_route_id INT NOT NULL,
    audit_task_id INT NOT NULL,
    route_street_id INT NOT NULL,
    PRIMARY KEY (audit_task_user_route_id),
    FOREIGN KEY (user_route_id) REFERENCES user_route(user_route_id),
    FOREIGN KEY (audit_task_id) REFERENCES audit_task(audit_task_id),
    FOREIGN KEY (route_street_id) REFERENCES route_street(route_street_id)
);

# --- !Downs
DROP TABLE audit_task_user_route;
DROP TABLE user_route;
DROP TABLE route_street;
DROP TABLE route;
