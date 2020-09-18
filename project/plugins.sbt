logLevel := Level.Warn

resolvers += "Typesafe repository" at "https://repo.typesafe.com/typesafe/releases/"

// The Sonatype snapshots repository
resolvers += "Sonatype snapshots" at "https://oss.sonatype.org/content/repositories/snapshots/"


// Use the Play sbt plugin for Play projects
addSbtPlugin("com.typesafe.play" % "sbt-plugin" % "2.3.8")

// Use the Scalariform plugin to reformat the code
addSbtPlugin("com.typesafe.sbt" % "sbt-scalariform" % "1.3.0")


// web plugins

//addSbtPlugin("com.typesafe.sbt" % "sbt-coffeescript" % "1.0.0")
//
//addSbtPlugin("com.typesafe.sbt" % "sbt-less" % "1.0.0")
//
//addSbtPlugin("com.typesafe.sbt" % "sbt-jshint" % "1.0.1")
//
//addSbtPlugin("com.typesafe.sbt" % "sbt-rjs" % "1.0.1")
//
//addSbtPlugin("com.typesafe.sbt" % "sbt-digest" % "1.0.0")
//
//addSbtPlugin("com.typesafe.sbt" % "sbt-mocha" % "1.0.0")
