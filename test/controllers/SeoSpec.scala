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
      val body = contentAsString(route(app, FakeRequest(GET, "/robots.txt")).get)
      body must include("Disallow: /admin")
      body must include("Disallow: /home")
      body must include("Sitemap: http")
      body must not include "Disallow: /\n"
    }
  }

  "GET /sitemap.xml" should {
    "list the public pages with absolute prod URLs" in {
      val resp = route(app, FakeRequest(GET, "/sitemap.xml")).get
      status(resp) mustBe OK
      contentType(resp) mustBe Some("application/xml")
      val body = contentAsString(resp)
      body must include("<urlset")
      body must include("/explore</loc>")
      body must include("/v3/api-docs/rawLabels</loc>")
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
      // The viewport meta must be inside the real <head>, not the legacy in-body block.
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
  }
}
