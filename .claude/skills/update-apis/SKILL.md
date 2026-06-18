---
name: update-apis
description: Makes updates to any of our /v3/api/ routes.
---

The set of updates that are likely to be involved:
1. Updating the database queries to incorporate the new/updated data (in the app/models/ files)
2. Making sure that the API is updated for every output file type (GeoJSON, CSV, Shapefile, and GeoPackage)
3. Updating the relevant documentation in the app/views/api/ files.

A few things to keep in mind:
* Combine common code where it makes sense to do so
* Run the queries both before and after your updates to check for any regressions
