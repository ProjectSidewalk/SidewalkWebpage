import scalariform.formatter.preferences._

name := """sidewalk-webpage"""

version := "5.0.0"

scalaVersion := "2.12.8"

sources in (Compile,doc) := Seq.empty

publishArtifact in (Compile, packageDoc) := false

resolvers += "Atlassian Releases" at "https://maven.atlassian.com/public/"

resolvers += Resolver.sonatypeRepo("snapshots")
resolvers += Resolver.bintrayRepo("jroper", "maven")

resolvers ++= Seq(
  "geosolutions" at "http://maven.geo-solutions.it/",
  "osgeo" at "http://download.osgeo.org/webdav/geotools/"
)

libraryDependencies ++= Seq(
  jdbc,
//  cache,
  "com.vividsolutions" % "jts" % "1.13",
  "com.typesafe.slick" %% "slick" % "2.1.0",
  "com.typesafe.play" %% "play-slick" % "3.0.3",
  "com.typesafe.play" %% "anorm" % "2.5.3",
  "org.postgresql" % "postgresql" % "9.3-1102-jdbc4",
  "com.mohiva" %% "play-silhouette" % "5.0.6",
  "com.mohiva" %% "play-silhouette-testkit" % "5.0.6" % "test",
  "org.webjars" %% "webjars-play" % "2.6.3",
  "org.webjars" % "bootstrap" % "3.1.1",
  "org.webjars" % "jquery" % "1.11.0",
  "net.codingwell" %% "scala-guice" % "4.2.2",
  "au.id.jazzy" %% "play-geojson" % "1.5.0",
  "com.github.tminglei" %% "slick-pg" % "0.17.0",
  "com.github.tminglei" %% "slick-pg_joda-time" % "0.17.0",
  "com.github.tminglei" %% "slick-pg_jts" % "0.17.0",
  "com.github.tminglei" %% "slick-pg_json4s" % "0.17.0",
  "com.github.tminglei" %% "slick-pg_play-json" % "0.17.0",
  "com.github.tminglei" %% "slick-pg_spray-json" % "0.17.0",
  "com.github.tminglei" %% "slick-pg_argonaut" % "0.17.0",
  "com.github.tminglei" %% "slick-pg_circe-json" % "0.17.0",
  "org.slf4j" % "slf4j-api"       % "1.7.7",
  "org.slf4j" % "jcl-over-slf4j"  % "1.7.7",
  "joda-time" % "joda-time" % "2.9.4",
  "org.geotools" % "gt-coverage" % "14.3",
  "org.geotools" % "gt-epsg-hsql" % "14.3",
  "org.geotools" % "gt-geotiff" % "14.3",
  "org.geotools" % "gt-main" % "14.3",
  "org.geotools" % "gt-referencing" % "14.3"
).map(_.force())

libraryDependencies ~= { _.map(_.exclude("org.slf4j", "slf4j-jdk14")) }

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

javacOptions ++= Seq("-source", "1.7", "-target", "1.7")

javaOptions ++= Seq("-Xmx3072M", "-Xms2048M", "-XX:MaxPermSize=3072M")

javaOptions in Test += "-Dconfig.file=conf/application.test.conf"

//********************************************************
// Scalariform settings
//********************************************************

//defaultScalariformSettings

scalariformPreferences := scalariformPreferences.value
  .setPreference(FormatXml, false)
  .setPreference(DoubleIndentConstructorArguments, false)
  .setPreference(DanglingCloseParenthesis, Preserve)

fork in run := true
