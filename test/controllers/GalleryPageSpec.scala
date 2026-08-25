package controllers

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._

import java.net.URLEncoder

/**
 * Locks the `tags` deep-link contract of GET /gallery: the selection a shared link carries has to come back on the
 * page, including for tag names that contain a comma (#4783).
 *
 * The filter is invisible when it breaks — an unrecognized tag is dropped rather than reported, so the page renders
 * a perfectly normal grid of unfiltered cards. That is how a comma-joined `tags` param hid the fact that it was
 * shredding "yellow box, accessibility features not visible" into two names that matched nothing.
 *
 * Reads the tag vocabulary off the page itself rather than hardcoding one, since which tags exist depends on the
 * city the connected database holds.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class GalleryPageSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  // Matches a whole tag-pill element so the active-class check doesn't depend on attribute order within the tag.
  // Twirl HTML-escapes ">" in attribute values, so [^>]* can't end the element early.
  private val tagPillElement = """<button\b[^>]*\bdata-tag="([^"]*)"[^>]*>""".r

  /** Fetches /gallery with the given query and returns its HTML. */
  private def galleryPage(query: String = ""): String = {
    val resp = route(app, FakeRequest(GET, s"/gallery$query")).get
    status(resp) mustBe OK
    contentAsString(resp)
  }

  private def renderedTags(body: String): Seq[String] =
    tagPillElement.findAllMatchIn(body).map(_.group(1)).distinct.toSeq
  private def activeTags(body: String): Set[String] =
    tagPillElement.findAllMatchIn(body).filter(_.matched.contains("tag-pill--active")).map(_.group(1)).toSet

  private def encode(tag: String): String = URLEncoder.encode(tag, "UTF-8")

  "GET /gallery" should {
    "render with no tags selected by default" in {
      activeTags(galleryPage()) mustBe empty
    }

    "restore every tag a repeated tags parameter names" in {
      val tags = renderedTags(galleryPage()).take(2)
      assume(tags.size == 2, "connected database renders fewer than two tags")

      val query = tags.map(tag => s"tags=${encode(tag)}").mkString("?", "&", "")
      activeTags(galleryPage(query)) must contain allElementsOf tags
    }

    "restore a tag whose name contains a comma" in {
      val commaTag = renderedTags(galleryPage()).find(_.contains(","))
      assume(commaTag.isDefined, "connected database has no tag containing a comma")

      activeTags(galleryPage(s"?tags=${encode(commaTag.get)}")) must contain(commaTag.get)
    }

    "still restore a link written in the older comma-joined form" in {
      val tags = renderedTags(galleryPage()).filterNot(_.contains(",")).take(2)
      assume(tags.size == 2, "connected database renders fewer than two comma-free tags")

      activeTags(galleryPage(s"?tags=${encode(tags.mkString(","))}")) must contain allElementsOf tags
    }

    "drop a tag the city does not have, rather than failing the page" in {
      activeTags(galleryPage("?tags=definitely-not-a-real-tag")) mustBe empty
    }

    "serve the page to a mobile visitor instead of redirecting to /mobileLanding" in {
      val mobileUa = "User-Agent" -> "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
      val resp     = route(app, FakeRequest(GET, "/gallery").withHeaders(mobileUa)).get
      status(resp) mustBe OK
    }
  }
}
