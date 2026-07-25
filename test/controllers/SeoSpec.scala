package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._

/**
 * Shared helpers for the SEO surface specs below (issue #4237): an anon session (most pages are SecuredActions that
 * bounce cookie-less requests through /anonSignUp) and a page fetch that follows that flow.
 */
trait SeoSpecHelpers { this: PlaySpec with GuiceOneAppPerSuite =>

  implicit lazy val mat: Materializer = app.materializer

  /** Cookies from the anonymous-signup flow, giving subsequent requests an authenticated session. */
  private lazy val anonCookies: Seq[Cookie] =
    cookies(route(app, FakeRequest(GET, "/anonSignUp?url=%2F")).get).toSeq

  /** Fetches a page as an anonymous-but-authenticated user and returns (status, body). */
  def getPage(path: String): (Int, String) = {
    val resp = route(app, FakeRequest(GET, path).withCookies(anonCookies: _*)).get
    (status(resp), contentAsString(resp))
  }

  /**
   * Fetches a page as a mobile-browser anonymous user. Needs its own cookie jar: Silhouette fingerprints the session
   * by User-Agent, so the shared desktop-minted cookies are rejected when replayed with a mobile UA.
   */
  def getMobilePage(path: String): (Int, String) = {
    val mobileUa      = "User-Agent" -> "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
    val mobileCookies = cookies(route(app, FakeRequest(GET, "/anonSignUp?url=%2F").withHeaders(mobileUa)).get).toSeq
    val resp          = route(app, FakeRequest(GET, path).withCookies(mobileCookies: _*).withHeaders(mobileUa)).get
    (status(resp), contentAsString(resp))
  }
}

/**
 * SEO surface on non-prod stages (issue #4237): test/local servers must never be indexed, so robots.txt disallows
 * everything and every page carries a noindex meta and no canonical (a canonical pointing at prod would conflict
 * with the noindex signal). Requires the Postgres+PostGIS test DB, like the other functional specs.
 */
class SeoSpec extends PlaySpec with GuiceOneAppPerSuite with SeoSpecHelpers {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("environment-type" -> "test")
      .build()

  "GET /robots.txt on a test stage" should {
    "disallow all crawling and advertise no sitemap" in {
      val resp = route(app, FakeRequest(GET, "/robots.txt")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("text/plain")
      val body = contentAsString(resp)
      body must include("Disallow: /")
      body must not include "Sitemap:"
    }
  }

  "GET /sitemap.xml on a test stage" should {
    "404 rather than serve cross-host prod URLs" in {
      status(route(app, FakeRequest(GET, "/sitemap.xml")).get) mustBe NOT_FOUND
    }
  }

  "Pages on a test stage" should {
    "carry noindex and no canonical" in {
      val (sc, body) = getPage("/")
      sc mustBe OK
      body must include("noindex")
      body must not include "rel=\"canonical\""
    }
  }
}

/**
 * SEO surface on prod (issue #4237): robots.txt allows crawling (minus admin/auth/alias paths) and points at the
 * sitemap; pages carry canonical + description + Open Graph/Twitter tags and no noindex; the landing page has an h1,
 * JSON-LD, and a viewport meta inside the real head. Requires the Postgres+PostGIS test DB.
 */
class SeoProdSpec extends PlaySpec with GuiceOneAppPerSuite with SeoSpecHelpers {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("environment-type" -> "prod")
      .build()

  "GET /robots.txt on prod" should {
    "allow crawling, disallow the admin/auth/alias surface, and advertise the sitemap" in {
      val resp = route(app, FakeRequest(GET, "/robots.txt")).get
      val body = contentAsString(resp)
      body must include("Disallow: /admin")
      body must include("Sitemap: http")
      body must not include "Disallow: /\n"
      // The alias Disallow lines are derived from the canonical-alias map, so assert against the same source.
      models.utils.SeoUtils.robotsDisallowedAliases.foreach { alias => body must include(s"Disallow: $alias") }
      // Crawlers reach every SecuredAction page via a 303 through /anonSignUp; blocking it blocks the whole site.
      body must not include "Disallow: /anonSignUp"
      // Aliases are prefix matches, so /v3/api-docs must not appear: it would block the /v3/api-docs/* doc pages.
      body must not include "Disallow: /v3/api-docs"
      header(CACHE_CONTROL, resp) mustBe defined
    }
  }

  "GET /sitemap.xml" should {
    "list the public pages with absolute prod URLs and no duplicate-alias URLs" in {
      val resp = route(app, FakeRequest(GET, "/sitemap.xml")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/xml")
      header(CACHE_CONTROL, resp) mustBe defined
      val body = contentAsString(resp)
      body must include("<urlset")
      body must include("/explore</loc>")
      body must include("/v3/api-docs/rawLabels</loc>")
      // The root <loc> keeps its trailing slash so it matches the landing page's rel=canonical URL exactly; no other
      // sitemap path ends in a slash.
      body must include("/</loc>")
      // Only canonical spellings belong in the sitemap; aliases would compete with their canonical pages.
      models.utils.SeoUtils.robotsDisallowedAliases.foreach { alias => body must not include s"$alias</loc>" }
      body must not include "/v3/api-docs</loc>"
    }
  }

  "The landing page on prod" should {
    "carry the full SEO head contract" in {
      val (sc, body) = getPage("/")
      sc mustBe OK
      body must include("rel=\"canonical\"")
      body must include("name=\"description\"")
      body must include("og:title")
      body must include("og:image")
      body must include("twitter:card")
      body must include("application/ld+json")
      body must include("<h1")
      body must not include "noindex"
      // The viewport meta must appear before </head> so browsers apply it during initial layout.
      body.indexOf("name=\"viewport\"") must be < body.indexOf("</head>")
    }

    "canonicalize the /home alias to the bare root" in {
      val (sc, body) = getPage("/home")
      sc mustBe OK
      // Scope the check to the canonical tag itself: the sign-in modal legitimately embeds returnUrl="/home".
      val canonicalHref = "rel=\"canonical\" href=\"([^\"]+)\"".r.findFirstMatchIn(body).map(_.group(1))
      canonicalHref.isDefined mustBe true
      canonicalHref.get must not include "/home"
    }

    "canonicalize the /v3/api-docs alias to /api" in {
      val (sc, body) = getPage("/v3/api-docs")
      sc mustBe OK
      val canonicalHref = "rel=\"canonical\" href=\"([^\"]+)\"".r.findFirstMatchIn(body).map(_.group(1))
      canonicalHref.isDefined mustBe true
      canonicalHref.get must endWith("/api")
    }
  }

  "API-docs pages" should {
    "carry the shared per-page title pattern" in {
      val (sc, body) = getPage("/v3/api-docs/rawLabels")
      sc mustBe OK
      body must include(s"<title>${models.utils.SeoUtils.apiDocsTitle("Raw Labels API")}</title>")
    }

    "contain no links to the nonexistent /api-docs/* path family" in {
      Seq("/v3/api-docs/rawLabels", "/v3/api-docs/labelClusters", "/v3/api-docs/regions", "/v3/api-docs/streets")
        .foreach { path =>
          val (sc, body) = getPage(path)
          sc mustBe OK
          withClue(s"$path links to a 404ing /api-docs/... URL: ") { body must not include "href=\"/api-docs/" }
        }
    }
  }

  "The mobile Validate page" should {
    "not get the viewport meta tag its fixed-size CSS predates" in {
      // mobile-validate.css is tuned for the ~980px fallback viewport phones use when no viewport meta is present.
      val (sc, body) = getMobilePage("/mobile")
      sc mustBe OK
      body must not include "name=\"viewport\""
    }
  }
}
