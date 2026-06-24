logLevel := Level.Warn

// The Typesafe repository.
resolvers += "Typesafe repository" at "https://repo.typesafe.com/typesafe/releases/"

// The Sonatype snapshots repository
// TODO remove this if it's no longer necessary after adding remaining libs.
//resolvers += "Sonatype snapshots" at "https://oss.sonatype.org/content/repositories/snapshots/"

// Use the Play sbt plugin for Play projects
addSbtPlugin("org.playframework" % "sbt-plugin" % "3.0.10")

// Code formatting check (scalafmtCheckAll). The scalafmt version itself is pinned in .scalafmt.conf (3.9.7); this
// plugin fetches it dynamically. Wired into CI as advisory-only for now (no repo-wide reformat pass yet).
addSbtPlugin("org.scalameta" % "sbt-scalafmt" % "2.5.4")

// Test coverage (scoverage). Used in a later CI phase with a low, ratcheting threshold.
addSbtPlugin("org.scoverage" % "sbt-scoverage" % "2.4.4")
