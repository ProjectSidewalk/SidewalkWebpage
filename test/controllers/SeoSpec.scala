package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._
import util.AnonSession

/**
 * Shared helpers for the SEO surface specs below (issue #4237): an anon session (some pages, e.g. /mobile, are still
 * SecuredActions that bounce cookie-less requests through /anonSignUp) and a page fetch that follows that flow. The
 * public pages themselves render cookie-less since #4643 — SessionlessPagesSpec pins that contract.
 */
trait SeoSpecHelpers extends AnonSession { this: PlaySpec with GuiceOneAppPerSuite =>

  implicit lazy val mat: Materializer = app.materializer

  /** Cookies from the anonymous-signup flow, giving subsequent requests an authenticated session. */
  private lazy val anonCookies: Seq[Cookie] = freshAnonSession()

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
    val mobileCookies = freshAnonSession(mobileUa)
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
      // Public pages render sessionlessly since #4643, so /anonSignUp is blocked: a crawler hitting it directly
      // would mint a throwaway anonymous account per hit.
      body must include("Disallow: /anonSignUp")
      // Aliases are prefix matches, so /v3/api-docs must not appear: it would block the /v3/api-docs/* doc pages.
      body must not include "Disallow: /v3/api-docs"
      // The retired mobile auth routes 301 to the already-disallowed /signIn·/signUp (#4884).
      body must not include "Disallow: /signInMobile"
      body must not include "Disallow: /signUpMobile"
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
      body must include("/about</loc>")
      body must include("/v3/api-docs/rawLabels</loc>")
      // Still-SecuredAction pages 303 crawlers into the disallowed /anonSignUp, so promoting them would only
      // manufacture crawl errors; they return to the sitemap if their shells go sessionless (#4643 phase 3).
      body must not include "/explore</loc>"
      body must not include "/validate</loc>"
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
    "lay out at the device's own width" in {
      val (sc, body) = getMobilePage("/mobile")
      sc mustBe OK
      body must include("content=\"width=device-width, initial-scale=1\"")
      // The viewport meta must appear before </head> so browsers apply it during initial layout.
      body.indexOf("name=\"viewport\"") must be < body.indexOf("</head>")
    }
  }

  "The About page" should {
    "render with an h1 and AboutPage JSON-LD" in {
      val (sc, body) = getPage("/about")
      sc mustBe OK
      body must include("<h1")
      body must include("AboutPage")
    }
  }
}

/**
 * SEO surface on a sign-in-walled city (#4643). Infra3D's imagery licence keeps every page behind a sign-in, so a
 * cookie-less crawler is bounced to /signIn — a path robots.txt disallows. Promoting pages that redirect into a
 * disallowed path only manufactures crawl errors, so such a city must advertise and serve no sitemap at all. Uses the
 * configured city with its pano source overridden, rather than hard-coding an Infra3D city id, so the spec doesn't
 * depend on which city this environment runs.
 */
class SeoSignInWalledSpec extends PlaySpec with GuiceOneAppPerSuite {

  private lazy val cityId: String = com.typesafe.config.ConfigFactory.load().getString("city-id")

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("environment-type" -> "prod", s"city-params.pano-viewer-type.$cityId" -> "infra3d")
      .build()

  implicit lazy val mat: Materializer = app.materializer

  "GET /sitemap.xml on a sign-in-walled prod city" should {
    "404 rather than promote pages that bounce a crawler to the disallowed /signIn" in {
      status(route(app, FakeRequest(GET, "/sitemap.xml")).get) mustBe NOT_FOUND
    }
  }

  "GET /robots.txt on a sign-in-walled prod city" should {
    "keep the Disallow rules but advertise no sitemap" in {
      val body = contentAsString(route(app, FakeRequest(GET, "/robots.txt")).get)
      body must include("Disallow: /admin")
      body must not include "Sitemap:"
    }
  }
}
