package models.utils

/**
 * SEO URL helpers backing the per-page <head> metadata in views.common.seoHead (issue #4237).
 */
object SeoUtils {

  /** Duplicate route aliases collapsed to one canonical path (conf/routes serves both spellings). */
  private val canonicalAliases: Map[String, String] = Map(
    "/home"            -> "/",
    "/developer"       -> "/api",
    "/v3/api-docs"     -> "/api",
    "/citiesDashboard" -> "/cities",
    "/labelmap"        -> "/labelMap",
    "/labelingguide"   -> "/labelingGuide",
    "/audit"           -> "/explore",
    "/adminValidate"   -> "/expertValidate"
  )

  /**
   * Alias paths that robots.txt should discourage crawling, derived from canonicalAliases so the two surfaces can't
   * drift. "/v3/api-docs" is excluded: robots Disallow rules are prefix matches, so listing it would also block the
   * canonical per-endpoint doc pages that live underneath it (/v3/api-docs/rawLabels etc.).
   */
  val robotsDisallowedAliases: Seq[String] = (canonicalAliases.keySet - "/v3/api-docs").toSeq.sorted

  /**
   * Collapses duplicate route aliases so every alias reports the same canonical path.
   *
   * @param requestPath The raw request path, e.g. "/home".
   * @return            The canonical path, e.g. "/".
   */
  def canonicalPathFor(requestPath: String): String = canonicalAliases.getOrElse(requestPath, requestPath)

  /**
   * Builds the absolute canonical URL for a page: prod base + alias-collapsed path. The query string is intentionally
   * dropped so filtered views (e.g. /gallery?severities=1) canonicalize to the filterless page.
   *
   * @param prodUrl Production base URL for this city, e.g. "https://sidewalk-sea.cs.washington.edu".
   * @param path    Request path to canonicalize.
   * @return        Absolute canonical URL, never with a trailing slash except the bare root.
   */
  def canonicalUrl(prodUrl: String, path: String): String = prodUrl.stripSuffix("/") + canonicalPathFor(path)

  /**
   * Page title for a per-endpoint API-docs page, keeping the shared brand suffix in one place. The docs are
   * English-only by design, so these titles bypass the seo.title.* Messages keys used by the rest of the site.
   *
   * @param pageName The docs page name, e.g. "Raw Labels API".
   * @return         The full title, e.g. "Raw Labels API — Project Sidewalk API Docs".
   */
  def apiDocsTitle(pageName: String): String = s"$pageName — Project Sidewalk API Docs"
}
