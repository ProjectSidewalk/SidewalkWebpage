logLevel := Level.Warn

resolvers += "Typesafe repository" at "https://repo.typesafe.com/typesafe/releases/"

// The Sonatype snapshots repository
resolvers += "Sonatype snapshots" at "https://oss.sonatype.org/content/repositories/snapshots/"


// Use the Play sbt plugin for Play projects
addSbtPlugin("com.typesafe.play" % "sbt-plugin" % "2.3.8")
