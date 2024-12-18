name := """sidewalk-webpage"""

version := "8.1.0-SNAPSHOT"

// TODO probably upgrade to scala 2.11?
scalaVersion := "2.10.7"

// TODO these two lines were in our build.sbt but not in template. Not sure if what to do with them.
sources in (Compile,doc) := Seq.empty
publishArtifact in (Compile, packageDoc) := false

// TODO copies these directly from our build.sbt. Not sure if we'll need them after upgrading libs.
resolvers := ("Atlassian Releases" at "https://maven.atlassian.com/public/") +: resolvers.value
resolvers += Resolver.sonatypeRepo("snapshots")
resolvers ++= Seq(
  "geosolutions" at "http://maven.geo-solutions.it/",
  "OSGeo" at "https://repo.osgeo.org/repository/release/"
)

// Play: https://mvnrepository.com/artifact/com.typesafe.play/play?repo=central
libraryDependencies ++= Seq(
  // At max version.
  "com.typesafe.play" %% "play-cache" % "2.4.11",
  "org.postgresql" % "postgresql" % "42.7.1",
  "com.typesafe.play" %% "play-slick" % "1.1.1", // https://mvnrepository.com/artifact/com.typesafe.play/play-slick?repo=central
  "com.typesafe.play" %% "play-slick-evolutions" % "1.1.1", // https://mvnrepository.com/artifact/com.typesafe.play/play-slick-evolutions?repo=central
  "net.codingwell" %% "scala-guice" % "4.1.1", // haven't upgraded at all yet. https://mvnrepository.com/artifact/net.codingwell/scala-guice

  // Not sure if they could be upgraded more, but we can wait until we finish upgrading Play all the way.
  "joda-time" % "joda-time" % "2.10.14", // https://mvnrepository.com/artifact/joda-time/joda-time

  // Need to test if they work with Play 2.4.11.
//  "com.typesafe.slick" %% "slick" % "3.1.1", // from 2.1.0
  "com.vividsolutions" % "jts" % "1.13",
  "com.github.tminglei" %% "slick-pg" % "0.14.9", // from 0.8.6 https://mvnrepository.com/artifact/com.github.tminglei/slick-pg
  "com.mohiva" %% "play-silhouette" % "3.0.5", // from 2.0.2 https://mvnrepository.com/artifact/com.mohiva/play-silhouette
//  "com.typesafe.play" %% "play-jdbc" % "2.4.11", // What is this for exactly? The test app loaded without it...

  // For automatic WKT to GeoJSON conversion.
  "org.wololo" % "jts2geojson" % "0.7.0", // TRY 0.7.0 instead of 0.14.3 to be compatible with jts 1.13!!! // https://mvnrepository.com/artifact/org.wololo/jts2geojson
  "org.geotools" % "gt-geojson" % "14.3" exclude("javax.media", "jai_core"),
  "javax.media" % "jai_core" % "1.1.3" from "https://repository.jboss.org/maven2/javax/media/jai-core/1.1.3/jai-core-1.1.3.jar",

  // For the new config.as[FiniteDuration] stuff. Might need 1.0.1 for Scala 2.10. Use 1.1.2 for Scala 2.11+.
  "net.ceedubs" %% "ficus" % "1.0.1", // https://mvnrepository.com/artifact/net.ceedubs/ficus

  // Might need these with slick-pg, I think they were separated out into smaller modules:
//  "com.github.tminglei" %% "slick-pg_joda-time" % "0.14.9", // NOT included after help from slick-pg guy
  "com.github.tminglei" %% "slick-pg_jts" % "0.14.9",
  //"com.github.tminglei" %% "slick-pg_date2" % "0.14.9", // included after help from slick-pg guy
//  "com.github.tminglei" %% "slick-pg_json4s" % "0.14.9" // NOT  included after help from slick-pg guy
  "com.github.tminglei" %% "slick-pg_play-json" % "0.14.9" // included after help from slick-pg guy
  // also might need joda-convert to directly use datetime objects, which I think was an issue for us in the past?

  // Start adding these dependencies!
  //  "com.typesafe.play" %% "anorm" % "2.3.10", // https://mvnrepository.com/artifact/com.typesafe.play/anorm / https://www.playframework.com/documentation/2.4.x/Migration24#Anorm
  //  "com.typesafe.play" %% "filters-helpers" % "2.3.10",
  //  "com.typesafe.play.extras" %% "play-geojson" % "1.3.1",

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
)

lazy val root = (project in file(".")).enablePlugins(PlayScala)

// TODO copied from our build.sbt. Probably they are fine as-is.
scalacOptions ++= Seq(
  "-deprecation", // Emit warning and location for usages of deprecated APIs.
  "-feature", // Emit warning and location for usages of features that should be imported explicitly.
  "-unchecked", // Enable additional warnings where generated code depends on assumptions.
  "-Xfatal-warnings", // Fail the compilation if there are any warnings.
  "-Xlint", // Enable recommended additional warnings.
  "-Ywarn-adapted-args", // Warn if an argument list is modified to match the receiver.
  "-Ywarn-dead-code", // Warn when dead code is identified.
  "-Ywarn-inaccessible", // Warn about inaccessible types in method signatures.
  "-Ywarn-nullary-override", // Warn when non-nullary overrides nullary, e.g. def foo() over def foo.
  "-Ywarn-numeric-widen" // Warn when numerics are widened.
)
javacOptions ++= Seq("-source", "1.8", "-target", "1.8")
javaOptions ++= Seq("-Xmx4096M", "-Xms2048M")

routesGenerator := InjectedRoutesGenerator
