package util

/**
 * User-Agent request headers for the specs that assert on which UI a request is served.
 *
 * `ControllerUtils.isMobile` is the single definition of that split (#4887), so a spec that wants the mobile branch
 * must send a UA it matches. Silhouette also fingerprints a session by User-Agent, so the same header has to go to
 * [[AnonSession.freshAnonSession]] and to every request that replays its cookies.
 */
object UserAgents {

  /** A UA that `ControllerUtils.isMobile` classifies as a phone. */
  val mobile: (String, String) = "User-Agent" -> "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
}
