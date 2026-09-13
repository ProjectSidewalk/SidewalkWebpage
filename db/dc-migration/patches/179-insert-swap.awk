# Swaps mainline 179.sql's version-gated old_label_metadata INSERT for the DC-aware one
# (issue #4700). Used by harness/gen-patches.sh; everything else passes through verbatim.
/^-- Store the old data\.$/ {
  print "-- Store the old data. Every DC label predates the fix; prefer the TRUE pre-fix"
  print "-- coordinates DC's fork saved (parked in dc_old_label_metadata_backup by preclean)."
  print "INSERT INTO old_label_metadata (label_id, old_pano_x, old_pano_y, old_camera_heading, old_camera_pitch, old_pano_lat, old_pano_lng)"
  print "SELECT label.label_id,"
  print "       COALESCE(dc_old_label_metadata_backup.old_sv_image_x, label_point.sv_image_x),"
  print "       COALESCE(dc_old_label_metadata_backup.old_sv_image_y, label_point.sv_image_y),"
  print "       label.photographer_heading, label.photographer_pitch, label.panorama_lat, label.panorama_lng"
  print "FROM label"
  print "INNER JOIN label_point ON label.label_id = label_point.label_id"
  print "LEFT JOIN dc_old_label_metadata_backup ON label.label_id = dc_old_label_metadata_backup.label_id;"
  skip = 1; next
}
skip && /version_id = '7\.12\.2'\);$/ { skip = 0; next }
!skip { print }
