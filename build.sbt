import play.PlayScala

name := """sidewalk-webpage"""

version := "6.14.7"

scalaVersion := "2.10.7"

sources in (Compile,doc) := Seq.empty

publishArtifact in (Compile, packageDoc) := false

// uncomment this when the sbt version is updated to > 0.13.7
// updateOptions := updateOptions.value.withCachedResolution(true)

resolvers := ("Atlassian Releases" at "https://maven.atlassian.com/public/") +: resolvers.value

resolvers += Resolver.sonatypeRepo("snapshots")

resolvers ++= Seq(
  "geosolutions" at "http://maven.geo-solutions.it/",
  "OSGeo" at "https://repo.osgeo.org/repository/release/"
)

libraryDependencies ++= Seq(
  "com.typesafe.play" %% "play-jdbc" % "2.3.10",
  "com.typesafe.play" %% "anorm" % "2.3.10",
  "com.typesafe.play" %% "play-cache" % "2.3.10",
  "com.typesafe.play" %% "filters-helpers" % "2.3.10",
  "com.vividsolutions" % "jts" % "1.13",
  "com.typesafe.slick" %% "slick" % "2.1.0",
  "com.typesafe.play" %% "play-slick" % "0.8.1",
  "com.typesafe.play" %% "play-mailer" % "2.4.1",
  "org.postgresql" % "postgresql" % "9.4.1212",
  "com.mohiva" %% "play-silhouette" % "2.0.2",
  "net.codingwell" %% "scala-guice" % "4.1.1",
  "com.typesafe.play.extras" %% "play-geojson" % "1.3.1",
  "com.github.tminglei" %% "slick-pg" % "0.8.6",
  "joda-time" % "joda-time" % "2.10.10",
  "org.geotools" % "gt-epsg-hsql" % "25.0",
  "org.geotools" % "gt-shapefile" % "25.0"
).map(_.force())

lazy val root = (project in file(".")).enablePlugins(PlayScala)

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

javaOptions ++= Seq("-Xmx3072M", "-Xms2048M")

javaOptions in Test += "-Dconfig.file=conf/application.test.conf"

fork in run := true
