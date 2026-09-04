# --- !Ups
-- Explore's labeling viewport is about to stop being a fixed 3:2 box (#5085), so a label's click coordinates have to
-- carry the frame they were measured in, the way label_validation.canvas_width/height always has. Evolution 177
-- dropped these two columns as dead weight because every frame was 720x480 at the time.
--
-- The frame is the one canvas_x/canvas_y are expressed in, not the on-screen size of the pano. Explore normalizes
-- every click into a logical frame 720 px wide (util.exploreCanvasFrame in public/js/common/utilities.js), so from
-- Explore canvas_width is always 720 and canvas_height is 720 divided by the displayed aspect ratio: 480 for the
-- boxed tool, about 405 for a 16:9 window. Only the aspect ratio matters to the projection that turns a click into
-- a direction, which is what makes a 720-wide frame exactly as good as the on-screen pixel size.
--
-- The defaults are exact history rather than a guess: the client has divided every click by its display scale since
-- the tool was built, so every existing row's canvas_x/canvas_y are in a 720x480 frame, and so are AI labels' (their
-- canvas_x/canvas_y are the center of that notional frame). ADD COLUMN with a constant default is metadata-only on
-- PostgreSQL 11+, so this does not rewrite label_point on any schema.
ALTER TABLE label_point
  ADD COLUMN canvas_width INTEGER NOT NULL DEFAULT 720,
  ADD COLUMN canvas_height INTEGER NOT NULL DEFAULT 480,
  ADD CONSTRAINT label_point_canvas_frame_check CHECK (canvas_width > 0 AND canvas_height > 0);

# --- !Downs
ALTER TABLE label_point
  DROP CONSTRAINT label_point_canvas_frame_check,
  DROP COLUMN canvas_width,
  DROP COLUMN canvas_height;
