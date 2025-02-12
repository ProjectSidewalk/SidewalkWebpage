logLevel := Level.Warn

// The Typesafe repository.
resolvers += "Typesafe repository" at "https://repo.typesafe.com/typesafe/releases/"

// The Sonatype snapshots repository
// TODO remove this if it's no longer necessary after adding remaining libs.
//resolvers += "Sonatype snapshots" at "https://oss.sonatype.org/content/repositories/snapshots/"

// Use the Play sbt plugin for Play projects
addSbtPlugin("com.typesafe.play" % "sbt-plugin" % "2.8.22")
