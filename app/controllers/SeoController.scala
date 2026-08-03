package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
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
   * Public, indexable pages promoted in the sitemap. Duplicate route aliases are excluded (see SeoUtils).
   * /explore and /validate are deliberately absent: they are still SecuredAction pages, so a cookie-less crawler gets
   * 303-bounced into the now-disallowed /anonSignUp — promoting them would just manufacture crawl errors. Re-add them
   * if/when the tool shells render sessionlessly (#4643 phase 3).
   */
  private val sitemapPaths: Seq[String] = Seq(
    "/", "/about", "/gallery", "/labelMap", "/help", "/labelingGuide", "/labelingGuide/curbRamps",
    "/labelingGuide/surfaceProblems", "/labelingGuide/obstacles", "/labelingGuide/noSidewalk",
    "/labelingGuide/occlusion", "/api", "/leaderboard", "/routeBuilder", "/terms", "/cities"
  ) ++ Seq(
    "labelTypes", "cities", "labelTags", "rawLabels", "labelClusters", "streets", "streetTypes", "regions",
    "accessScoreStreets", "accessScoreRegions", "validations", "validation-result-types", "user-stats", "overall-stats",
    "overall-stats-by-day", "aggregate-stats", "aggregate-stats-by-day"
  ).map(p => s"/v3/api-docs/$p")

  /** Duplicate-alias Disallow lines, derived from the same alias map that drives canonical URLs (SeoUtils). */
  private val aliasDisallowLines: String = SeoUtils.robotsDisallowedAliases.map(p => s"Disallow: $p").mkString("\n")

  /**
   * The robots.txt body is fully determined by construction-time config, so build it once.
   *
   * /anonSignUp is disallowed now that the public pages render for cookie-less clients without a session (#4643):
   * crawlers no longer get 303-bounced through it, and letting them hit it directly would mint a throwaway anonymous
   * account (a DB user + session write) per hit. Pages that remain SecuredAction (/explore, /validate) still 303
   * through it, which is why they are excluded from the sitemap above.
   */
  private val robotsBody: String =
    if (envType == "prod")
      s"""User-agent: *
         |Disallow: /admin
         |Disallow: /adminapi/
         |Disallow: /userapi/
         |Disallow: /anonSignUp
         |Disallow: /signIn
         |Disallow: /signInMobile
         |Disallow: /signUp
         |Disallow: /signUpMobile
         |Disallow: /signOut
         |Disallow: /forgotPassword
         |Disallow: /resetPassword
         |Disallow: /welcome
         |Disallow: /changeLanguage
         |Disallow: /dashboard
         |$aliasDisallowLines
         |
         |Sitemap: $baseUrl/sitemap.xml
         |""".stripMargin
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
   * Serves sitemap.xml listing the public pages with absolute prod URLs. Prod only: a sitemap on a test/local host
   * would list cross-host (prod) URLs, which search engines reject, and those stages are noindexed anyway.
   */
  def sitemap: Action[AnyContent] = Action {
    if (envType == "prod")
      Ok(sitemapBody).as("application/xml; charset=utf-8").withHeaders(CACHE_CONTROL -> "public, max-age=86400")
    else NotFound
  }
}
