package controllers

import models.label.LabelMetadata
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.LabelService

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Functional tests for the public label-share surface (issue #456): GET /label/:labelId (rich-preview landing) and
 * GET /label/:labelId/image (crawler-facing preview image).
 *
 * Both endpoints must be reachable with no auth cookie so social crawlers can read the Open Graph / Twitter Card
 * preview. Asserts response shape (status, content type, presence of the OG/Twitter meta and the image permalink),
 * not data values. Boots the full application against the real Slick/PostGIS DB; the eager background actors are
 * disabled so they don't fire DB/WS work during the test.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class ShareControllerSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // The image endpoint streams a file (sendFile), which needs a real Materializer to consume; the test default is
  // NoMaterializer, which only works for strict bodies.
  implicit lazy val mat: Materializer = app.materializer

  private val labelService: LabelService = app.injector.instanceOf[LabelService]

  /**
   * A real label id seeded in the connected test DB, or `None` if the DB holds no labels.
   *
   * Sourced from the app itself (most-recent label) rather than a hardcoded id, so the valid-id assertions run against
   * whatever data the connected DB happens to contain.
   *
   * @return `Some(labelId)` of an existing label, or `None` when the DB is empty of labels.
   */
  private lazy val validLabelId: Option[Int] =
    Await.result(labelService.getRecentLabelMetadata(1), 60.seconds).headOption.map((m: LabelMetadata) => m.labelId)

  "GET /label/:labelId" should {
    "render the share landing (200, no auth) with OG/Twitter meta and the preview-image permalink" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val resp = route(app, FakeRequest(GET, s"/label/$id")).get
          status(resp) mustBe OK

          val body = contentAsString(resp)
          body must include("og:title")
          body must include("og:image")
          body must include("twitter:card")
          body must include(s"/label/$id/image")
      }
    }

    "return 404 for a nonexistent label id" in {
      val resp = route(app, FakeRequest(GET, "/label/999999999")).get
      status(resp) mustBe NOT_FOUND
    }
  }

  "GET /label/:labelId/image" should {
    "serve an image (200, no auth) for a valid label" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val resp = route(app, FakeRequest(GET, s"/label/$id/image")).get
          status(resp) mustBe OK
          // May be the composited crop/GSV still or the branded fallback; all are served as image/*.
          contentType(resp).exists(_.startsWith("image/")) mustBe true
      }
    }
  }
}
