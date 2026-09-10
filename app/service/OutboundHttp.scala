package service

/**
 * What our server-to-server HTTP calls have in common.
 */
object OutboundHttp {

  /**
   * How we identify ourselves to keyless, community-run APIs (Panoramax, #5185; the OSM API, #5244). Where a key
   * already says who is calling (GSV, Mapillary) nothing else is needed, but these operators otherwise have no way to
   * tell whose traffic this is or where to write if it misbehaves, and the OSM API's usage policy requires it.
   */
  val UserAgent: String = "ProjectSidewalk/1.0 (+https://projectsidewalk.org; sidewalk@cs.uw.edu)"
}
