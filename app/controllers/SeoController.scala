package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
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

  /** Public, indexable pages promoted in the sitemap. Duplicate route aliases are excluded (see SeoUtils). */
  private val sitemapPaths: Seq[String] = Seq(
    "/", "/explore", "/validate", "/gallery", "/labelMap", "/help", "/labelingGuide", "/labelingGuide/curbRamps",
    "/labelingGuide/surfaceProblems", "/labelingGuide/obstacles", "/labelingGuide/noSidewalk",
    "/labelingGuide/occlusion", "/api", "/leaderboard", "/routeBuilder", "/terms", "/cities"
  ) ++ Seq(
    "labelTypes", "cities", "labelTags", "rawLabels", "labelClusters", "streets", "streetTypes", "regions",
    "accessScoreStreets", "accessScoreRegions", "validations", "validation-result-types", "user-stats", "overall-stats",
    "overall-stats-by-day", "aggregate-stats", "aggregate-stats-by-day"
  ).map(p => s"/v3/api-docs/$p")

  /**
   * Serves robots.txt: on prod, allow crawling minus admin/auth/duplicate-alias surface and point at the sitemap;
   * on test/local, disallow everything (pages also carry a noindex meta via seoHead).
   */
  def robots: Action[AnyContent] = Action {
    val body =
      if (envType == "prod")
        s"""User-agent: *
           |Disallow: /admin
           |Disallow: /adminapi/
           |Disallow: /userapi/
           |Disallow: /signIn
           |Disallow: /signInMobile
           |Disallow: /signUp
           |Disallow: /signUpMobile
           |Disallow: /signOut
           |Disallow: /forgotPassword
           |Disallow: /resetPassword
           |Disallow: /anonSignUp
           |Disallow: /welcome
           |Disallow: /changeLanguage
           |Disallow: /dashboard
           |Disallow: /home
           |Disallow: /developer
           |Disallow: /citiesDashboard
           |Disallow: /labelmap
           |Disallow: /labelingguide
           |Disallow: /audit
           |Disallow: /adminValidate
           |
           |Sitemap: $baseUrl/sitemap.xml
           |""".stripMargin
      else "User-agent: *\nDisallow: /\n"
    Ok(body).as("text/plain; charset=utf-8")
  }

  /** Serves sitemap.xml listing the public pages with absolute prod URLs. */
  def sitemap: Action[AnyContent] = Action {
    val urls = sitemapPaths
      .map(p => s"  <url><loc>$baseUrl${if (p == "/") "" else p}</loc></url>")
      .mkString("\n")
    Ok(
      s"""<?xml version="1.0" encoding="UTF-8"?>
         |<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
         |$urls
         |</urlset>
         |""".stripMargin
    ).as("application/xml; charset=utf-8")
  }
}
