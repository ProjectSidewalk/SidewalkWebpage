name := """sidewalk-webpage"""

version := "9.1.0"

scalaVersion := "2.13.16"

// These lines prevent documentation from being generated. Once we clean up our Scaladoc, we can remove these lines.
Compile / doc / sources := Seq.empty
Compile / packageDoc / publishArtifact := false

// Need these for the geotools dependencies.
resolvers ++= Seq(
  "geosolutions" at "https://maven.geo-solutions.it/",
  "OSGeo" at "https://repo.osgeo.org/repository/release/"
)

// Play: https://mvnrepository.com/artifact/com.typesafe.play/play?repo=central
libraryDependencies ++= Seq(
  // General Play stuff.
  "org.playframework" %% "play-guice" % "3.0.8",
  "org.playframework" %% "play-cache" % "3.0.8",
  "org.playframework" %% "play-ws" % "3.0.8",
  "org.playframework" %% "play-caffeine-cache" % "3.0.8",
  "org.playframework" %% "play-mailer" % "10.1.0", // play-mailer is on a different versioning scheme than Play itself.
  "org.playframework" %% "play-mailer-guice" % "10.1.0", // play-mailer is on a different versioning scheme than Play itself.
  "org.playframework" %% "play-json" % "3.0.5", // play-json is on a different versioning scheme than Play itself.

  // Authentication using Silhouette.
  "org.playframework.silhouette" %% "play-silhouette" % "10.0.3",
  "org.playframework.silhouette" %% "play-silhouette-password-bcrypt" % "10.0.3",
  "org.playframework.silhouette" %% "play-silhouette-crypto-jca" % "10.0.3",
  "org.playframework.silhouette" %% "play-silhouette-persistence" % "10.0.3",
  "net.codingwell" %% "scala-guice" % "6.0.0", // This on top of play-guice, I think to simplify SilhouetteModule.scala.
  "com.iheart" %% "ficus" % "1.5.2",

  // Slick and Postgres stuff.
  "org.postgresql" % "postgresql" % "42.7.7",
  "org.playframework" %% "play-slick" % "6.2.0",
  "org.playframework" %% "play-slick-evolutions" % "6.2.0",

  // Slick-pg modules and dependencies.
  "com.github.tminglei" %% "slick-pg" % "0.23.1",
  "com.github.tminglei" %% "slick-pg_jts_lt" % "0.23.1",
  "com.github.tminglei" %% "slick-pg_play-json" % "0.23.1",
  "org.locationtech.jts" % "jts" % "1.20.0",

  // For automatic WKT to GeoJSON and Shapefile conversion, used with slick-pg.
  "org.n52.jackson" % "jackson-datatype-jts" % "1.2.10",

  // Adds parallel collections to Scala, which were separated out starting at Scala 2.13.
  "org.scala-lang.modules" %% "scala-parallel-collections" % "1.2.0",

  // Used for the sign in/up views. https://github.com/mohiva/play-silhouette-seed/blob/1710f9f3337cbe10d1928fd53a5ab933352b3cf5/build.sbt
  // Find versions here (P26-B3 is Play 2.6, Bootstrap 3): https://adrianhurt.github.io/play-bootstrap/changelog/
  // TODO no releases since Play 2.8. Seems to continue to work, but should consider other options.
  "com.adrianhurt" %% "play-bootstrap" % "1.6.1-P28-B3",

  // Used to create shapefiles. The jai_core lib isn't available from maven, so we're setting a separate download link.
  "javax.media" % "jai_core" % "1.1.3" from "https://repo.osgeo.org/repository/release/javax/media/jai_core/1.1.3/jai_core-1.1.3.jar",
  "org.geotools" % "gt-shapefile" % "29.6" exclude("javax.media", "jai_core"),
  "org.geotools" % "gt-epsg-hsql" % "29.6" exclude("javax.media", "jai_core"),
  "org.geotools" % "gt-geopkg" % "29.6" exclude("javax.media", "jai_core"),

  // Used for processing data from AI server.
  "org.apache.httpcomponents" % "httpmime" % "4.5.14",
)

lazy val root = (project in file(".")).enablePlugins(PlayScala)

scalacOptions ++= Seq(
  "-deprecation", // Emit warning and location for usages of deprecated APIs.
  "-feature", // Emit warning and location for usages of features that should be imported explicitly.
  "-unchecked", // Enable additional warnings where generated code depends on assumptions.

  // Fail the compilation if there are any warnings. But suppress the warnings/errors in Twirl templates (.scala.html)
  // and silence unused import warnings in the routes file. But are bugged and bugged and incorrectly throw errors.
  "-Xfatal-warnings",
  "-Wconf:src=views/.*:s",
  "-Wconf:cat=unused-imports&src=.*routes.*:s",

  "-Xlint", // Enable recommended additional warnings.
  "-Wunused:explicits", // Warn if an explicit parameter is unused.
  "-Wunused:implicits", // Warn if an implicit parameter is unused.
  "-Wdead-code", // Warn when dead code is identified.
  "-Wvalue-discard", // Warn when non-Unit expression results are unused.
  "-Wnumeric-widen" // Warn when numerics are widened.
)

javacOptions ++= Seq("-source", "17", "-target", "17")
javaOptions ++= Seq("-Xmx4096M", "-Xms2048M")
