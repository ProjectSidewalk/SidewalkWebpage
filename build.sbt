import com.typesafe.sbt.packager.MappingsHelper.directory

name := """sidewalk-webpage"""

version := "11.10.0"

scalaVersion := "2.13.18"

// These lines prevent documentation from being generated. Once we clean up our Scaladoc, we can remove these lines.
Compile / doc / sources                := Seq.empty
Compile / packageDoc / publishArtifact := false

// Need these for the geotools dependencies.
resolvers ++= Seq(
  "geosolutions" at "https://maven.geo-solutions.it/",
  "OSGeo" at "https://repo.osgeo.org/repository/release/"
)

// Play: https://mvnrepository.com/artifact/com.typesafe.play/play?repo=central
libraryDependencies ++= Seq(
  // General Play stuff.
  "org.playframework" %% "play-guice"          % "3.0.11",
  "org.playframework" %% "play-cache"          % "3.0.11",
  "org.playframework" %% "play-ws"             % "3.0.11",
  "org.playframework" %% "play-caffeine-cache" % "3.0.11",
  "org.playframework" %% "play-mailer" % "10.1.0", // play-mailer is on a different versioning scheme than Play itself.
  "org.playframework" %% "play-mailer-guice" % "10.1.0", // play-mailer is on a different versioning scheme than Play itself.
  "org.playframework" %% "play-json" % "3.0.6", // play-json is on a different versioning scheme than Play itself.

  // Authentication using Silhouette.
  "org.playframework.silhouette" %% "play-silhouette"                 % "10.0.4",
  "org.playframework.silhouette" %% "play-silhouette-password-bcrypt" % "10.0.4",
  "org.playframework.silhouette" %% "play-silhouette-crypto-jca"      % "10.0.4",
  "org.playframework.silhouette" %% "play-silhouette-persistence"     % "10.0.4",
  "net.codingwell" %% "scala-guice" % "6.0.0", // This on top of play-guice, I think to simplify SilhouetteModule.scala.
  "com.iheart"     %% "ficus"       % "1.5.2",

  // Slick and Postgres stuff.
  "org.postgresql"     % "postgresql"            % "42.7.12",
  "org.playframework" %% "play-slick"            % "6.2.0",
  "org.playframework" %% "play-slick-evolutions" % "6.2.0",

  // Slick-pg modules and dependencies.
  "com.github.tminglei" %% "slick-pg"           % "0.23.1",
  "com.github.tminglei" %% "slick-pg_jts_lt"    % "0.23.1",
  "com.github.tminglei" %% "slick-pg_play-json" % "0.23.1",
  "org.locationtech.jts" % "jts"                % "1.20.0",

  // For automatic WKT to GeoJSON and Shapefile conversion, used with slick-pg.
  "org.n52.jackson" % "jackson-datatype-jts" % "1.2.10",

  // Reads EXIF (photos) and QuickTime/MP4 atoms (videos, for the later #4054 increments) from user-uploaded story
  // media. Pure Java, one small transitive dep (xmpcore). Used transiently on ingest; precise values are discarded.
  "com.drewnoakes" % "metadata-extractor" % "2.19.0",

  // Used for the sign in/up views. https://github.com/mohiva/play-silhouette-seed/blob/1710f9f3337cbe10d1928fd53a5ab933352b3cf5/build.sbt
  // Find versions here (P26-B3 is Play 2.6, Bootstrap 3): https://adrianhurt.github.io/play-bootstrap/changelog/
  // TODO no releases since Play 2.8. Seems to continue to work, but should consider other options.
  "com.adrianhurt" %% "play-bootstrap" % "1.6.1-P28-B3",

  // Used to create shapefiles. The jai_core lib isn't available from maven, so we're setting a separate download link.
  "javax.media" % "jai_core" % "1.1.3" from "https://repo.osgeo.org/repository/release/javax/media/jai_core/1.1.3/jai_core-1.1.3.jar",
  "org.geotools" % "gt-shapefile" % "29.6" exclude ("javax.media", "jai_core"),
  "org.geotools" % "gt-epsg-hsql" % "29.6" exclude ("javax.media", "jai_core"),
  "org.geotools" % "gt-geopkg"    % "29.6" exclude ("javax.media", "jai_core"),

  // Testing. scalatestplus-play pulls in ScalaTest + Play's test helpers (FakeRequest, route, etc.).
  "org.scalatestplus.play" %% "scalatestplus-play" % "7.0.2" % Test
)

lazy val root = (project in file(".")).enablePlugins(PlayScala)

// Package the scripts/ directory into the staged/dist build. ClusterService shells out to scripts/label_clustering.py
// at runtime via a working-directory-relative path, so a prod/staged app (whose working dir is the stage dir, not the
// repo root) can only find it if it's copied into the distribution alongside the app.
Universal / mappings ++= directory(baseDirectory.value / "scripts")

// Content-fingerprint every asset (#4486): sbt-digest writes an `<md5>-<name>` copy, `assets.path(...)` resolves to
// it, and `Assets.versioned` serves that `immutable` for a year instead of the one-hour default. Originals stay in
// place, so hardcoded `/assets/...` paths still resolve (uncached).
//
// Covering everything, not just the render-blocking JS/CSS, is a correctness fix. Play's fallback ETag comes from an
// asset's path plus a last-modified date that sbt's `packageTimestamp` freezes at 2010-01-01, so swapping a file's
// bytes under the same name leaves cached copies revalidating to a 304 forever. Costs ~291MB per staged instance.
//
// Leave this unscoped. sbt-web feeds plain `pipelineStages` into `pipeline`, which only `stage`/`dist` run, but feeds
// `Assets / pipelineStages` into `Assets / mappings` -> `Assets / assets`, which Play's dev build link runs on every
// request. Scoping it to Assets therefore fingerprints during `run` as well, which buys nothing (dev serves
// `no-cache`) and grows `target/web` from 290MB to ~880MB in every checkout and QA worktree.
pipelineStages := Seq(digest)

// Stamp git metadata into the binary at build time (generates models.utils.BuildInfo), so the running app can report
// exactly what code it was built from (surfaced on the admin pages' deployment-info strip). Deploy builds run from
// full persistent clones on the deploy server, so real values are the norm; every value degrades gracefully to
// None/false when git can't answer (a shallow/tagless CI checkout, a tarball build) — the build must never fail over
// this. Deliberately no build timestamp: it would change the generated source on every compile and trigger needless
// recompilation under `~ run`. The `-c safe.directory` guard covers repos owned by a different user than the build
// process (dockerized dev, the deploy servers).
Compile / sourceGenerators += Def.task {
  def git(args: String*): Option[String] = scala.util
    .Try {
      val cmd = Seq("git", "-c", s"safe.directory=${baseDirectory.value.getAbsolutePath}") ++ args
      scala.sys.process.Process(cmd, baseDirectory.value).!!(scala.sys.process.ProcessLogger(_ => ())).trim
    }
    .toOption
    .filter(_.nonEmpty)

  // Escape backslashes/quotes before splicing into the generated source, so an odd tag name can't break the compile.
  def lit(o: Option[String]): String =
    o.fold("None")(v => "Some(\"" + v.replace("\\", "\\\\").replace("\"", "\\\"") + "\")")
  val sha      = git("rev-parse", "HEAD")
  val describe = git("describe", "--tags", "--always")
  val dirty    = git("status", "--porcelain").isDefined // Clean tree -> empty output -> None.

  val file = (Compile / sourceManaged).value / "models" / "utils" / "BuildInfo.scala"
  IO.write(
    file,
    s"""package models.utils
       |
       |/** Git metadata captured at build time. GENERATED by the sourceGenerator in build.sbt — do not edit. */
       |object BuildInfo {
       |
       |  /** Full SHA of the commit the app was built from; None if git couldn't answer at build time. */
       |  val gitSha: Option[String] = ${lit(sha)}
       |
       |  /** `git describe --tags --always` at build time: the nearest ancestor release tag and distance from it. */
       |  val gitDescribe: Option[String] = ${lit(describe)}
       |
       |  /** Whether the working tree had uncommitted changes at build time. */
       |  val gitDirty: Boolean = $dirty
       |}
       |""".stripMargin
  )
  Seq(file)
}.taskValue

// The families of public/ assets whose URLs frontend JS builds at runtime, and so must be able to fingerprint through
// `util.assetPath` (#4893). Everything under these prefixes goes into the generated inventory below, which
// AssetManifestService turns into the `window.assetDigests` stamp main.scala.html puts on every page.
//
// tools/check-asset-paths.mjs parses this Seq to decide which logical paths `util.assetPath` may name, so keep the
// literal shape — one quoted prefix per line. `locales` is deliberately absent: i18next-http-backend interpolates its
// own `loadPath` template, so those URLs never reach the helper.
val assetManifestPrefixes = Seq(
  "audio",
  "images/badges",
  "images/examples",
  "images/explore",
  "images/icons",
  "images/logos",
  "images/pano-tutorial",
  "images/tutorials",
  "images/validate"
)

// Generate models.utils.AssetInventory: the sorted logical paths of every file under the prefixes above, so the app
// can ask `AssetsFinder` for each one's fingerprinted URL at startup without walking the filesystem itself.
//
// Fails the build on a prefix that doesn't resolve, unlike the git metadata above. `public/` is always present, so a
// missing prefix means a renamed asset family — and skipping it would silently un-fingerprint every URL in that family
// with nothing going red (`AssetsFinder.path` returns the plain path for an asset it can't find, it never throws).
//
// Output is sorted and deterministic so the generated source is byte-identical between compiles and zinc has nothing
// to recompile.
Compile / sourceGenerators += Def.task {
  val publicDir = baseDirectory.value / "public"
  val paths: Seq[String] = assetManifestPrefixes.flatMap { prefix =>
    val dir = publicDir / prefix
    if (!dir.isDirectory) {
      sys.error(s"build.sbt: asset manifest prefix 'public/$prefix' is not a directory. If the asset family moved, " +
        "update assetManifestPrefixes (and the util.assetPath call sites naming it).")
    }
    (dir ** "*")
      .get()
      .filter(_.isFile)
      .flatMap(_.relativeTo(publicDir))
      .map(_.getPath.replace('\\', '/'))
      // Editor/OS droppings (.DS_Store, .gitkeep) are not assets anything asks for.
      .filterNot(_.split('/').exists(_.startsWith(".")))
  }.sorted

  // Escape before splicing, so an unusual filename can't break the generated source the way it can't break BuildInfo.
  def lit(p: String): String = "\"" + p.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

  val file = (Compile / sourceManaged).value / "models" / "utils" / "AssetInventory.scala"
  IO.write(
    file,
    s"""package models.utils
       |
       |/**
       | * Logical paths of the public/ assets whose URLs frontend JS builds at runtime (#4893).
       | *
       | * GENERATED by the sourceGenerator in build.sbt from `assetManifestPrefixes` — do not edit. Sorted, so the
       | * generated source only changes when the asset tree does.
       | */
       |object AssetInventory {
       |
       |  /** Every inventoried asset's path under `public/`, e.g. `images/icons/openhand.cur`. Sorted. */
       |  val paths: Seq[String] = Seq(
       |${paths.map(p => s"    ${lit(p)}").mkString(",\n")}
       |  )
       |}
       |""".stripMargin
  )
  Seq(file)
}.taskValue

// Statement-coverage ratchet (#4743), enforced by backend-tests; see docs/testing-and-ci.md.
//
// Don't set this from a local run, which scores far higher: CI measured 36.39% where the same spec list against a
// seeded local DB gave 43.66%, and the full local suite 62.06%. Both the enrollment list (#5042) and CI's empty
// schema pull the number down. Read the new figure off a CI run before raising this.
coverageMinimumStmtTotal := 36
coverageFailOnMinimum    := true

// Twirl templates emit the JS reverse router for the browser, so nothing calls it from Scala: 692 statements no test
// can reach. The Scala router and the templates themselves stay in — the functional specs render pages and route
// requests, so their coverage is real.
coverageExcludedPackages := """controllers\.javascript\..*"""

scalacOptions ++= Seq(
  "-deprecation", // Emit warning and location for usages of deprecated APIs.
  "-feature",     // Emit warning and location for usages of features that should be imported explicitly.
  "-unchecked",   // Enable additional warnings where generated code depends on assumptions.

  // Fail the compilation if there are any warnings. But suppress the warnings/errors in Twirl templates (.scala.html)
  // and silence unused import warnings in the routes file. But are bugged and bugged and incorrectly throw errors.
  "-Xfatal-warnings", "-Wconf:src=views/.*:s", "-Wconf:cat=unused-imports&src=.*routes.*:s", "-Xlint", // Enable recommended additional warnings.
  "-Wunused:explicits", // Warn if an explicit parameter is unused.
  "-Wunused:implicits", // Warn if an implicit parameter is unused.
  "-Wdead-code",        // Warn when dead code is identified.
  "-Wvalue-discard",    // Warn when non-Unit expression results are unused.
  "-Wnumeric-widen"     // Warn when numerics are widened.
)

javacOptions ++= Seq("-source", "17", "-target", "17")
javaOptions ++= Seq("-Xmx4096M", "-Xms2048M")
