package models.utils

import models.pano.PanoSource
import play.api.Configuration

/**
 * SEO URL helpers backing the per-page <head> metadata in views.common.seoHead (issue #4237).
 */
object SeoUtils {

  /**
   * Whether search engines may index this deployment — the single predicate behind every indexing signal (#5120):
   * the robots meta tag, the `X-Robots-Tag` header, the sitemap, and robots.txt's `Sitemap:` line.
   *
   * A deployment's Apache vhost may still send its own `X-Robots-Tag`, applied after the backend and so masking this;
   * see docs/deployment-and-stages.md → "Search-engine indexing".
   *
   * Three conditions must all hold for a deployment to be indexable:
   *  - it is production (a test/local/staging host indexed alongside prod outranks it — see #2806);
   *  - the city is launched publicly (`status = "public"` in cityparams; the private deployments are research
   *    partnerships and pilots that are not ours to publish);
   *  - its imagery licence does not put every page behind a sign-in, since a sign-in-walled city has nothing a
   *    cookie-less crawler can reach (#4643). This conflates "unreachable to a crawler" with "must not be indexed",
   *    which is worth revisiting if a publicly launched Infra3D city ever ships — none exists today.
   *
   * @param environmentType `environment-type` for this deployment.
   * @param cityStatus      `city-params.status.<cityId>`: "public" or "private".
   * @param panoViewerType  `city-params.pano-viewer-type.<cityId>`, as a [[PanoSource]] name.
   * @return                True iff this deployment should be crawled and indexed.
   */
  def isIndexable(environmentType: String, cityStatus: String, panoViewerType: String): Boolean =
    environmentType == "prod" && cityStatus == "public" && panoViewerType != PanoSource.Infra3d.toString

  /**
   * Applies [[isIndexable]] to a deployment's configuration, for the callers that hold a `Configuration` rather than
   * a `CommonPageData`. All three keys are static config, so callers can evaluate this once at construction.
   *
   * @param config The application configuration.
   * @return       True iff this deployment should be crawled and indexed.
   */
  def isIndexable(config: Configuration): Boolean = {
    val cityId: String = config.get[String]("city-id")
    isIndexable(
      config.get[String]("environment-type"),
      config.get[String](s"city-params.status.$cityId"),
      config.get[String](s"city-params.pano-viewer-type.$cityId")
    )
  }

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
