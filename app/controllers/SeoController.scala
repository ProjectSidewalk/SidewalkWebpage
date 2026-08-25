package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import models.pano.PanoSource
import models.utils.SeoUtils
import play.api.Configuration
import play.api.mvc.{Action, AnyContent}

import javax.inject._

/**
 * Serves robots.txt and sitemap.xml (issue #4237).
 *
 * Both actions are plain (non-Silhouette) Actions on purpose: crawlers hit these URLs constantly, and a SecuredAction
 * would create an anonymous user + session DB writes per hit. Everything here is derived from static config, so no
 * DB access is needed at all.
 */
@Singleton
class SeoController @Inject() (cc: CustomControllerComponents, config: Configuration) extends CustomBaseController(cc) {

  private val envType: String = config.get[String]("environment-type")
  private val cityId: String  = config.get[String]("city-id")

  /** Prod base URL for this city; the sitemap/canonical surface always points at prod, never a test domain. */
  private val baseUrl: String = config.get[String](s"city-params.landing-page-url.prod.$cityId").stripSuffix("/")

  /**
   * Whether this city's imagery licence puts its whole surface behind a sign-in.
   *
   * Infra3D cities require per-user imagery permission, so `CustomSecurityService` bounces a cookie-less visitor from
   * *every* page to /signIn — which robots.txt disallows. Read straight from config, the same key
   * `ConfigService.getPanoSource` uses, so this controller keeps its build-once, no-DB property.
   */
  private val signInWalled: Boolean =
    config.get[String](s"city-params.pano-viewer-type.$cityId") == PanoSource.Infra3d.toString

  /**
   * Public, indexable pages promoted in the sitemap. Duplicate route aliases are excluded (see SeoUtils).
   *
   * The invariant is that every entry renders for a cookie-less crawler. /explore and /validate are absent because
   * they are still SecuredAction pages and 303 into the disallowed /anonSignUp — promoting them would only manufacture
   * "redirect blocked by robots.txt" errors. Re-add them if/when the tool shells render sessionlessly (#4643 phase 3).
   * The same invariant empties the list entirely on a sign-in-walled city, where the redirect target is /signIn.
   */
  private val sitemapPaths: Seq[String] =
    if (signInWalled) Seq.empty
    else
      Seq(
        "/", "/about", "/gallery", "/labelMap", "/help", "/labelingGuide", "/labelingGuide/curbRamps",
        "/labelingGuide/surfaceProblems", "/labelingGuide/obstacles", "/labelingGuide/noSidewalk",
        "/labelingGuide/occlusion", "/api", "/leaderboard", "/routeBuilder", "/terms", "/cities"
      ) ++ Seq(
        "labelTypes", "cities", "labelTags", "rawLabels", "labelClusters", "streets", "streetTypes", "regions",
        "accessScoreStreets", "accessScoreRegions", "validations", "validation-result-types", "user-stats",
        "overall-stats", "overall-stats-by-day", "aggregate-stats", "aggregate-stats-by-day"
      ).map(p => s"/v3/api-docs/$p")

  /** Duplicate-alias Disallow lines, derived from the same alias map that drives canonical URLs (SeoUtils). */
  private val aliasDisallowLines: String = SeoUtils.robotsDisallowedAliases.map(p => s"Disallow: $p").mkString("\n")

  /** A sitemap is served only where there is something crawlable to promote; robots.txt advertises it only then. */
  private val hasSitemap: Boolean = envType == "prod" && sitemapPaths.nonEmpty

  /**
   * The robots.txt body is fully determined by construction-time config, so build it once.
   *
   * /anonSignUp is disallowed because a crawler hitting it mints a throwaway anonymous account (a DB user + a session
   * write) per hit, and the sitemap surface reaches every indexable page without it (#4643). SecuredAction pages
   * (/explore, /validate) 303 into it, which is why they stay out of the sitemap above.
   */
  private val robotsBody: String =
    if (envType == "prod")
      s"""User-agent: *
         |Disallow: /admin
         |Disallow: /adminapi/
         |Disallow: /userapi/
         |Disallow: /anonSignUp
         |Disallow: /signIn
         |Disallow: /signUp
         |Disallow: /signOut
         |Disallow: /forgotPassword
         |Disallow: /resetPassword
         |Disallow: /welcome
         |Disallow: /changeLanguage
         |Disallow: /dashboard
         |$aliasDisallowLines
         |${if (hasSitemap) s"\nSitemap: $baseUrl/sitemap.xml\n" else ""}""".stripMargin
    else "User-agent: *\nDisallow: /\n"

  private val sitemapBody: String = {
    // Each <loc> goes through SeoUtils.canonicalUrl so the sitemap and the pages' rel=canonical tags agree by
    // construction — notably the root, which canonicalizes with a trailing slash ("https://host/").
    val urls = sitemapPaths
      .map(p => s"  <url><loc>${SeoUtils.canonicalUrl(baseUrl, p)}</loc></url>")
      .mkString("\n")
    s"""<?xml version="1.0" encoding="UTF-8"?>
       |<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
       |$urls
       |</urlset>
       |""".stripMargin
  }

  /**
   * Serves robots.txt: on prod, allow crawling minus admin/auth/duplicate-alias surface and point at the sitemap;
   * on test/local, disallow everything (pages also carry a noindex meta via seoHead).
   */
  def robots: Action[AnyContent] = Action {
    Ok(robotsBody).as("text/plain; charset=utf-8").withHeaders(CACHE_CONTROL -> "public, max-age=86400")
  }

  /**
   * Serves sitemap.xml listing the public pages with absolute prod URLs. Prod only, and only where a cookie-less
   * crawler can actually reach those pages: a sitemap on a test/local host would list cross-host (prod) URLs, which
   * search engines reject, and a sign-in-walled city has nothing to promote (see `sitemapPaths`).
   */
  def sitemap: Action[AnyContent] = Action {
    if (hasSitemap)
      Ok(sitemapBody).as("application/xml; charset=utf-8").withHeaders(CACHE_CONTROL -> "public, max-age=86400")
    else NotFound
  }
}
