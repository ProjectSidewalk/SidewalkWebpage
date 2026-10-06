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

  /** A tablet that says so: `isMobile` matches its `iPad` token (Firefox on iPad, or Safari's "Request Mobile Website"). */
  val tablet: (String, String) = "User-Agent" -> "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"

  /**
   * What Safari on an iPad sends by default since iPadOS 13: a Mac UA, which `isMobile` cannot tell from a real Mac.
   * Kept as documentation of why device class can't be read from the UA (#5664).
   */
  val desktopIpad: (String, String) =
    "User-Agent" -> "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"
}
