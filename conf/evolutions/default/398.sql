# --- !Ups
-- Street gradient (#5223). One row per street: its running slope, climb and elevation profile, sampled along the
-- centerline from a bare-earth elevation model by scripts/street_gradient.py and loaded by
-- db/scripts/import-street-gradient.sh. Unlike intersection and sidewalk_presence this table cannot be derived from
-- the schema's own rows (the elevations come from rasters the database never sees), so there is no derivation here
-- and no nightly rebuild, and the table starts empty in every city. docs/street-gradient.md has the method and the
-- measurements behind its constants.
--
-- Grades are fractions (0.05 is a 5% grade). net_grade, climb_m and descent_m follow the street's digitized
-- direction, mean_grade and max_grade are absolute. profile_cm holds elevations in whole centimeters at even spacing
-- from the first vertex to the last (about every 10 m), so the spacing is the street's length over one less than the
-- array's length. meters_over_5pct_grade and meters_over_8pct_grade are the length of street steeper than the ADA /
-- PROWAG walking-surface limit (1:20) and ramp limit (1:12, so 8.33% exactly, named for the round figure).
--
-- quality says how the profile was obtained. A bare-earth model removes bridges and knows nothing of tunnels, so a
-- street tagged as one (structure) has its two endpoint elevations and no grade at all: its ends sit at the lip of
-- what it crosses, where the model already reads partway down, so even a line between them is steep on a level deck.
-- A street whose sampled profile holds an implausible pitch the tags did not explain, or a pitch steeper than any real
-- street (suspect), carries a straight line between its endpoint elevations instead of samples. no_data means the
-- model had nothing under the street or under either of its ends, and every statistic is NULL. They are NULL as well
-- on the few suspect streets whose own endpoints imply a grade no street has (a short stub with one end on each side
-- of a retaining wall), since there is no trustworthy line to draw.
--
-- confidence is a function of the model's grid size, from the resolution sweep against 1 m lidar: a bare-earth model
-- at 10 m or finer reproduces the statistics below closely, one at 20 m less so, and a coarser one supports
-- net_grade alone, which is why the windowed statistics may be NULL on a row that still has a net_grade.
--
-- There is no Slick model yet, on purpose: nothing in the app reads or writes this table until the API phase of
-- #5223, which adds StreetGradientTable alongside its first query.
--
-- geom_md5 is md5(ST_AsBinary(street_edge.geom)) at sampling time, so a street whose geometry has been edited since
-- shows up as stale by comparing the two.
CREATE TYPE street_gradient_quality AS ENUM ('measured', 'structure', 'suspect', 'no_data');
CREATE TYPE street_gradient_confidence AS ENUM ('high', 'medium', 'low');

CREATE TABLE street_gradient (
    street_edge_id INTEGER PRIMARY KEY REFERENCES street_edge(street_edge_id) ON DELETE CASCADE,
    quality street_gradient_quality NOT NULL,
    confidence street_gradient_confidence NOT NULL,
    net_grade DOUBLE PRECISION,
    mean_grade DOUBLE PRECISION CHECK (mean_grade >= 0),
    max_grade DOUBLE PRECISION CHECK (max_grade >= 0),
    meters_over_5pct_grade DOUBLE PRECISION CHECK (meters_over_5pct_grade >= 0),
    meters_over_8pct_grade DOUBLE PRECISION CHECK (meters_over_8pct_grade >= 0),
    climb_m DOUBLE PRECISION CHECK (climb_m >= 0),
    descent_m DOUBLE PRECISION CHECK (descent_m >= 0),
    elev_start_m DOUBLE PRECISION,
    elev_end_m DOUBLE PRECISION,
    profile_cm INTEGER[],
    dem_source TEXT NOT NULL CHECK (dem_source <> ''),
    dem_resolution_m DOUBLE PRECISION NOT NULL CHECK (dem_resolution_m > 0),
    geom_md5 TEXT NOT NULL CHECK (geom_md5 ~ '^[0-9a-f]{32}$'),
    sampled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Named by what they assert, since Postgres already takes <table>_<column>_check for the inline checks above.
    CONSTRAINT street_gradient_statistics_match_quality_check CHECK (
        (elev_start_m IS NULL) = (elev_end_m IS NULL)
        AND CASE quality
            WHEN 'measured' THEN net_grade IS NOT NULL AND elev_start_m IS NOT NULL
            WHEN 'structure' THEN net_grade IS NULL AND elev_start_m IS NOT NULL
            WHEN 'no_data' THEN net_grade IS NULL AND elev_start_m IS NULL
            ELSE (net_grade IS NULL) = (elev_start_m IS NULL)
        END
    ),
    CONSTRAINT street_gradient_windowed_statistics_together_check CHECK (
        (mean_grade IS NULL) = (max_grade IS NULL)
        AND (mean_grade IS NULL) = (meters_over_5pct_grade IS NULL)
        AND (mean_grade IS NULL) = (meters_over_8pct_grade IS NULL)
        AND (mean_grade IS NULL) = (climb_m IS NULL)
        AND (mean_grade IS NULL) = (descent_m IS NULL)
        AND (mean_grade IS NULL) = (profile_cm IS NULL)
        AND (mean_grade IS NULL OR net_grade IS NOT NULL)
    ),
    CONSTRAINT street_gradient_threshold_ordering_check CHECK (meters_over_8pct_grade <= meters_over_5pct_grade),
    CONSTRAINT street_gradient_confidence_matches_resolution_check CHECK (
        confidence = CASE WHEN dem_resolution_m <= 10 THEN 'high'
                          WHEN dem_resolution_m <= 20 THEN 'medium'
                          ELSE 'low' END::street_gradient_confidence
    )
);
ALTER TABLE street_gradient OWNER TO sidewalk;

# --- !Downs
DROP TABLE IF EXISTS street_gradient;
DROP TYPE IF EXISTS street_gradient_confidence;
DROP TYPE IF EXISTS street_gradient_quality;
