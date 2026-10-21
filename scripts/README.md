# `scripts/`

Only what the running app shells out to lives here, because `build.sbt` bundles this whole directory into the
staged package. Everything a person or CI runs is under [`tools/`](../tools/README.md).

`label_clustering.py` runs on `python3` (3.8) with [`requirements.txt`](../requirements.txt): the server's system
Python, currently EOL (#4396), so never add a library there that has dropped 3.8.

## `label_clustering.py`

Clusters a region's accessibility labels by type and posts the results back to the app.

This one **is** invoked in-band: `ClusterService.runMultiUserClustering`
([`app/service/ClusterService.scala`](../app/service/ClusterService.scala)) shells out to it once per
region when an admin triggers clustering at `/runClustering` (and on the nightly `ClusteringActor` schedule). The script GETs the region's labels from
`/labelsToClusterInRegion`, clusters each label type independently (complete-linkage hierarchical clustering over
haversine distance, with per-type distance thresholds; labels from the same user+pano are never clustered together),
makes the cluster ids globally unique, and POSTs the labels, clusters, and thresholds back to `/clusteringResults`.

```bash
INTERNAL_API_KEY=<internal-api-key> python3 scripts/label_clustering.py --region_id <id> [--debug]
```

- `INTERNAL_API_KEY` (env) — the internal API key, sent as an `Authorization: Bearer` header (kept off the command
  line so it can't leak into `ps`/access logs). The app passes `config.get[String]("internal-api-key")`.
- `--region_id` — the region whose labels to cluster.
- `--debug` — print per-type cluster counts and coordinate-cleaning stats.
- `SIDEWALK_HTTP_PORT` (env) — app port, defaults to `9000`.

Because this one runs in-band, the deployed app has to be able to both **find** and **run** it: `scripts/` is bundled
into the staged package via `Universal / mappings` in [`build.sbt`](../build.sbt) and `ClusterService` resolves it
against the app root (not the process working directory), and its [`requirements.txt`](../requirements.txt)
dependencies must be installed in the `python3` interpreter the app shells out to.

## Testing

```bash
make test-python          # both halves, in the web container
make test-python-app      # just label_clustering.py, on python3 (3.8)
```

See [`test/python/README.md`](../test/python/README.md).
