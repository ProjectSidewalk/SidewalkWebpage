name := """sidewalk-webpage"""

version := "8.1.0-SNAPSHOT"

scalaVersion := "2.13.16"

// TODO these two lines were in our build.sbt but not in template. Not sure if what to do with them.
Compile / doc / sources := Seq.empty
Compile / packageDoc / publishArtifact := false

// TODO copies these directly from our build.sbt. Not sure if we'll need them after upgrading libs.
resolvers := ("Atlassian Releases" at "https://maven.atlassian.com/public/") +: resolvers.value
resolvers += Resolver.sonatypeRepo("snapshots")
resolvers ++= Seq(
  "geosolutions" at "https://maven.geo-solutions.it/",
  "OSGeo" at "https://repo.osgeo.org/repository/release/"
)

// Play: https://mvnrepository.com/artifact/com.typesafe.play/play?repo=central
libraryDependencies ++= Seq(
  // General Play stuff.
  "com.typesafe.play" %% "play-guice" % "2.8.22",
  "com.typesafe.play" %% "play-cache" % "2.8.22",
  "com.typesafe.play" %% "play-ws" % "2.8.22",
  "com.typesafe.play" %% "play-caffeine-cache" % "2.8.22",
  "com.typesafe.play" %% "play-json" % "2.9.4", // play-json is on a different versioning scheme than Play itself.
  "net.codingwell" %% "scala-guice" % "5.1.1",

  // Authentication using Silhouette.
  // TODO Switching to org.playframework.silhouette in v9+, starting Play 2.9.
  "io.github.honeycomb-cheesecake" %% "play-silhouette" % "8.0.2", // from 3.0.5 https://mvnrepository.com/artifact/com.mohiva/play-silhouette
  "io.github.honeycomb-cheesecake" %% "play-silhouette-password-bcrypt" % "8.0.2", // was split from play-silhouette in 4.0.0
  "io.github.honeycomb-cheesecake" %% "play-silhouette-crypto-jca" % "8.0.2", // added in 4.0.0
  "io.github.honeycomb-cheesecake" %% "play-silhouette-persistence" % "8.0.2",
  "com.iheart" %% "ficus" % "1.5.2",

  // Slick and Postgres stuff.
  "org.postgresql" % "postgresql" % "42.7.1",
  "com.typesafe.play" %% "play-slick" % "5.1.0", // https://mvnrepository.com/artifact/com.typesafe.play/play-slick?repo=central
  "com.typesafe.play" %% "play-slick-evolutions" % "5.1.0", // https://mvnrepository.com/artifact/com.typesafe.play/play-slick-evolutions?repo=central

  // Slick-pg modules and dependencies.
  "com.github.tminglei" %% "slick-pg" % "0.21.1", // from 0.8.6 https://mvnrepository.com/artifact/com.github.tminglei/slick-pg
  //  "com.github.tminglei" %% "slick-pg_joda-time" % "0.14.9", // NOT included after help from slick-pg guy
  "com.github.tminglei" %% "slick-pg_jts_lt" % "0.21.1",
  //  "com.github.tminglei" %% "slick-pg_date2" % "0.15.7", // included after help from slick-pg guy -- now included in slick-pg starting at 0.15.0
  //  "com.github.tminglei" %% "slick-pg_json4s" % "0.14.9" // NOT  included after help from slick-pg guy
  "com.github.tminglei" %% "slick-pg_play-json" % "0.21.1", // included after help from slick-pg guy
  // also might need joda-convert to directly use datetime objects, which I think was an issue for us in the past?
  // TODO try to update to 1.2.0 when we get to Play 2.9+. At least 1.19.0 was tested with slick-pg.
  "org.locationtech.jts" % "jts" % "1.16.1",

  // For automatic WKT to GeoJSON conversion, used with slick-pg.
  "org.wololo" % "jts2geojson" % "0.14.3",
  "org.geotools" % "gt-geojson" % "24.0",

  // Adds parallel collections to Scala, which were separated out starting at Scala 2.13.
  "org.scala-lang.modules" %% "scala-parallel-collections" % "1.0.4",

  // Not sure if they could be upgraded more, but we can wait until we finish upgrading Play all the way.
  "joda-time" % "joda-time" % "2.12.7", // https://mvnrepository.com/artifact/joda-time/joda-time

  // Used for the sign in/up views. https://github.com/mohiva/play-silhouette-seed/blob/1710f9f3337cbe10d1928fd53a5ab933352b3cf5/build.sbt
  // Find versions here (P26-B3 is Play 2.6, Bootstrap 3): https://adrianhurt.github.io/play-bootstrap/changelog/
  "com.adrianhurt" %% "play-bootstrap" % "1.6.1-P28-B3"

//  "org.geotools" % "gt-epsg-hsql" % "25.0" exclude("javax.media", "jai_core"),
//  "org.geotools" % "gt-shapefile" % "25.0" exclude("javax.media", "jai_core"),
//  // Below are transitive dependencies that were missing jars in default repositories.
//  // https://github.com/aileenzeng/sidewalk-docker/issues/5
//  // https://github.com/aileenzeng/sidewalk-docker/issues/26
//  // https://stackoverflow.com/questions/50058646/sbt-occurred-an-error-because-failed-to-install-a-dependency-at-first-time-thoug
//  // https://github.com/sbt/sbt/issues/1138#issuecomment-36169177
//  "javax.media" % "jai_core" % "1.1.3" from "https://repository.jboss.org/maven2/javax/media/jai-core/1.1.3/jai-core-1.1.3.jar"

  // Stuff I could consider leaving out until the very end bc they are somewhat self-contained.
  //  "com.typesafe.play" %% "play-mailer" % "2.4.1",
  //  "com.typesafe.play" %% "filters-helpers" % "2.3.10", // to 2.4.11

  // Looking like we never used anorm, but it helps with getting data types right from raw sql queries maybe?
  //  "com.typesafe.play" %% "anorm" % "2.3.10", // https://mvnrepository.com/artifact/com.typesafe.play/anorm / https://www.playframework.com/documentation/2.4.x/Migration24#Anorm

  // Not being maintained anymore. Looks like I can just replace it with using play-json & slick-pg and adding custom formatters.
  //  "com.typesafe.play.extras" %% "play-geojson" % "1.3.1",
)

// TODO Added because of a conflict between jts2geojson 0.14.3 and jts 1.16.1. Try to remove after upgrading to Play 2.9+.
dependencyOverrides += "org.locationtech.jts" % "jts-core" % "1.16.1"

lazy val root = (project in file(".")).enablePlugins(PlayScala)

scalacOptions ++= Seq(
  "-deprecation", // Emit warning and location for usages of deprecated APIs.
  "-feature", // Emit warning and location for usages of features that should be imported explicitly.
  "-unchecked", // Enable additional warnings where generated code depends on assumptions.
//  "-Xfatal-warnings", // Fail the compilation if there are any warnings.
  "-Xlint", // Enable recommended additional warnings.
  "-Wunused:explicits", // Warn if an explicit parameter is unused.
  "-Wunused:implicits", // Warn if an implicit parameter is unused.
  "-Wdead-code", // Warn when dead code is identified.
  "-Wvalue-discard", // Warn when non-Unit expression results are unused.
  "-Wnumeric-widen" // Warn when numerics are widened.
)
javacOptions ++= Seq("-source", "1.8", "-target", "1.8")
javaOptions ++= Seq("-Xmx4096M", "-Xms2048M")
