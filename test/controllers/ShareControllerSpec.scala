package controllers

import models.label.{LabelMetadata, LabelPointTable, LabelTypeEnum, LocationXY}
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.i18n.{Lang, MessagesApi}
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.LabelService

import java.awt.image.BufferedImage
import java.io.{ByteArrayInputStream, File}
import javax.imageio.ImageIO
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Functional tests for the public label-share surface (issue #456): GET /label/:labelId (rich-preview landing) and
 * GET /label/:labelId/image (crawler-facing preview image), plus the two reads the share landing opened to anonymous
 * access and the image-compositing internals.
 *
 * Both endpoints must be reachable with no auth cookie so social crawlers can read the Open Graph / Twitter Card
 * preview. Asserts response shape (status, content type, the OG/Twitter meta contract, image dimensions), not data
 * values. Boots the full application against the real Slick/PostGIS DB; the eager background actors are disabled so
 * they don't fire DB/WS work during the test.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 * Valid-label tests source ids from the connected DB and cancel (not fail) when no suitable label exists.
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
  private val messagesApi: MessagesApi   = app.injector.instanceOf[MessagesApi]
  implicit private val lang: Lang        = Lang("en") // Requests below send no Accept-Language, so Play serves English.

  /**
   * Recent labels from the connected test DB, providing real ids to exercise. Sourcing ids from the app keeps the
   * assertions valid against whatever data the connected DB happens to contain.
   */
  private lazy val recentLabels: Seq[LabelMetadata] =
    Await.result(labelService.getRecentLabelMetadata(50), 60.seconds)

  private lazy val validLabelId: Option[Int] = recentLabels.headOption.map(_.labelId)

  /** A recent label whose type matches the predicate, or `None`; lets tests target the title-copy fork. */
  private def labelWhere(pred: LabelMetadata => Boolean): Option[LabelMetadata] = recentLabels.find(pred)

  "GET /label/:labelId" should {
    "render the share landing (200, no auth) with the full OG/Twitter meta contract" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val resp = route(app, FakeRequest(GET, s"/label/$id")).get
          status(resp) mustBe OK

          val body = contentAsString(resp)
          body must include("og:title")
          body must include("og:description")
          body must include("og:url")
          body must include("og:image")
          body must include("og:image:width")
          body must include("og:image:height")
          body must include("og:image:alt")
          body must include("twitter:card")
          body must include("twitter:image:alt")
          body must include("summary_large_image")
          body must include(s"/label/$id/image")
      }
    }

    "not mint a session or account for an anonymous view" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val resp = route(app, FakeRequest(GET, s"/label/$id")).get
          status(resp) mustBe OK
          // The historical behavior this feature deliberately avoids: SecuredAction 302s anonymous visitors through
          // /anonSignUp, creating a DB user + auth cookie per crawler hit. The share landing must set no session.
          val sessionCookieName = app.configuration.get[String]("play.http.session.cookieName")
          headers(resp).get(SET_COOKIE).getOrElse("") must not include sessionCookieName
      }
    }

    "use the issue title framing for access-issue label types" in {
      labelWhere(_.labelType.isAccessIssue) match {
        case None        => cancel("No recent access-issue label in the test DB.")
        case Some(label) =>
          val body = contentAsString(route(app, FakeRequest(GET, s"/label/${label.labelId}")).get)
          body must include(messagesApi("share.meta.title.issue", messagesApi(label.labelType.nameKey)))
      }
    }

    "use the feature title framing for non-issue label types" in {
      labelWhere(!_.labelType.isAccessIssue) match {
        case None        => cancel("No recent non-issue label in the test DB.")
        case Some(label) =>
          val body = contentAsString(route(app, FakeRequest(GET, s"/label/${label.labelId}")).get)
          body must include(messagesApi("share.meta.title.feature", messagesApi(label.labelType.nameKey)))
      }
    }

    "return 404 for a nonexistent label id" in {
      status(route(app, FakeRequest(GET, "/label/999999999")).get) mustBe NOT_FOUND
    }
  }

  "GET /label/:labelId/image" should {
    "serve a JPEG (200, no auth) at exactly the advertised share dimensions" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val resp = route(app, FakeRequest(GET, s"/label/$id/image")).get
          status(resp) mustBe OK
          contentType(resp) mustBe Some("image/jpeg")
          header(CACHE_CONTROL, resp).getOrElse("") must include("max-age")

          // The meta advertises og:image:width/height 1440x960; the pipeline must make that true for every source
          // (stored crop, GSV still, or fallback), so decode the actual bytes and check.
          val img = ImageIO.read(new ByteArrayInputStream(contentAsBytes(resp).toArray))
          img.getWidth mustBe 1440
          img.getHeight mustBe 960
      }
    }

    "serve identical bytes on a repeat request (disk-cached, stable URL)" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val first  = contentAsBytes(route(app, FakeRequest(GET, s"/label/$id/image")).get)
          val second = contentAsBytes(route(app, FakeRequest(GET, s"/label/$id/image")).get)
          second mustBe first
      }
    }

    "return 404 for a nonexistent label id" in {
      status(route(app, FakeRequest(GET, "/label/999999999/image")).get) mustBe NOT_FOUND
    }
  }

  // The share landing renders LabelMap anonymously, which calls these two endpoints; they were relaxed from
  // SecuredAction to public reads (per-user fields fall back to the no-user case) as part of #456.
  "reads opened to anonymous access for the share landing" should {
    "serve label detail JSON at /label/id/:labelId with no auth cookie" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val resp = route(app, FakeRequest(GET, s"/label/id/$id")).get
          status(resp) mustBe OK
          contentType(resp) mustBe Some("application/json")
          contentAsString(resp) must include("label_id")
      }
    }

    "serve the neighborhoods FeatureCollection at /neighborhoods with no auth cookie" in {
      val resp = route(app, FakeRequest(GET, "/neighborhoods")).get
      status(resp) mustBe OK
      contentAsString(resp) must include("FeatureCollection")
    }
  }

  "compositeMarker" should {
    val controller = app.injector.instanceOf[ShareController]

    /** Builds a solid-color base image for compositing tests. */
    def solidBase(w: Int, h: Int, rgb: Int): BufferedImage = {
      val img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
      val g   = img.createGraphics()
      g.setColor(new java.awt.Color(rgb))
      g.fillRect(0, 0, w, h)
      g.dispose()
      img
    }

    /** Center of the bounding box of all pixels that differ from the background color. */
    def markerCenter(img: BufferedImage, bgRgb: Int): (Int, Int) = {
      var (minX, minY, maxX, maxY) = (Int.MaxValue, Int.MaxValue, -1, -1)
      for {
        y <- 0 until img.getHeight
        x <- 0 until img.getWidth
      } {
        if ((img.getRGB(x, y) & 0xffffff) != bgRgb) {
          minX = math.min(minX, x); minY = math.min(minY, y)
          maxX = math.max(maxX, x); maxY = math.max(maxY, y)
        }
      }
      withClue("expected the marker icon to change at least one pixel: ") { maxX must be >= 0 }
      ((minX + maxX) / 2, (minY + maxY) / 2)
    }

    val bg           = 0xcc0000 // Solid red; no label-type icon is red, so any non-red pixel is the marker.
    val canvasCenter = LocationXY(LabelPointTable.canvasWidth / 2, LabelPointTable.canvasHeight / 2)

    "output the fixed share dimensions and keep a centered marker centered for a 4:3 GSV-sized base" in {
      // 640x480 is what the GSV Static API actually returns; cover-cropping 4:3 to 3:2 trims top/bottom, and a
      // marker at the canvas center must map to the output center through that transform.
      val out = controller.compositeMarker(solidBase(640, 480, bg), LabelTypeEnum.CurbRamp, canvasCenter)
      out.getWidth mustBe 1440
      out.getHeight mustBe 960
      val (cx, cy) = markerCenter(out, bg)
      cx must be(720 +- 3)
      cy must be(480 +- 3)
    }

    "keep a centered marker centered for a crop-sized (already 3:2) base" in {
      val out      = controller.compositeMarker(solidBase(1440, 960, bg), LabelTypeEnum.NoCurbRamp, canvasCenter)
      val (cx, cy) = markerCenter(out, bg)
      cx must be(720 +- 3)
      cy must be(480 +- 3)
    }

    "map an off-center canvas position through the cover-crop transform" in {
      // Canvas x at 1/4 width on a 3:2 base (scale-only, no crop): marker center must land at 1/4 output width.
      val quarter  = LocationXY(LabelPointTable.canvasWidth / 4, LabelPointTable.canvasHeight / 2)
      val out      = controller.compositeMarker(solidBase(1440, 960, bg), LabelTypeEnum.Obstacle, quarter)
      val (cx, cy) = markerCenter(out, bg)
      cx must be(360 +- 3)
      cy must be(480 +- 3)
    }
  }

  "buildFallbackImage" should {
    "write a branded fallback at exactly the advertised share dimensions" in {
      val controller = app.injector.instanceOf[ShareController]
      val tmp        = new File(System.getProperty("java.io.tmpdir"), s"share-fallback-spec-${System.nanoTime()}.jpg")
      try {
        controller.buildFallbackImage(tmp)
        assert(tmp.exists(), "fallback image file was not written (is public/assets/sidewalk-logo.png present?)")
        val img = ImageIO.read(tmp)
        img.getWidth mustBe 1440
        img.getHeight mustBe 960
      } finally { val _ = tmp.delete() }
    }
  }
}
