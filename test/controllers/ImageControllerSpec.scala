package controllers

import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.{PanoDataService, ShareImageCache}

import java.awt.image.BufferedImage
import java.io.{ByteArrayOutputStream, File}
import java.util.Base64
import javax.imageio.ImageIO

/**
 * Functional tests for `POST /saveImage` (#4415, #4726). Boots the real app and drives the endpoint over HTTP through
 * Silhouette's anonymous session, so it exercises routing, auth, the JSON contract, the base64 decode + resize, and
 * the share-preview cache invalidation that hangs off a successful write.
 *
 * That invalidation is the point of most of this. `/label/:id/image` caches whatever base image it can find — the
 * label's crop, else a fetched Street View still, else a branded placeholder — with no expiry, and Explore lets a
 * labeler share a label the moment they place it, seconds before its crop lands. So each crop that arrives has to
 * drop the preview built without it.
 *
 * Every test addresses a **synthetic** label id no real label uses. Crops live on disk keyed by id alone, so a real
 * id would overwrite a real label's crop with this suite's fixture image.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class ImageControllerSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val panoDataService: PanoDataService = app.injector.instanceOf[PanoDataService]
  private val shareImageCache: ShareImageCache = app.injector.instanceOf[ShareImageCache]

  // Far outside the range of any real label id, so writing a crop here can't clobber one.
  private val syntheticLabelId      = Int.MaxValue - 4726
  private val otherSyntheticLabelId = Int.MaxValue - 4727
  private val labelType             = "CurbRamp"

  /** A real 2x2 PNG as the `data:` URL the canvas sends, since the controller decodes and re-encodes it. */
  private lazy val cropDataUrl: String = {
    val img = new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB)
    img.setRGB(0, 0, 0x00ff00)
    val out = new ByteArrayOutputStream()
    val _   = ImageIO.write(img, "png", out)
    s"data:image/png;base64,${Base64.getEncoder.encodeToString(out.toByteArray)}"
  }

  /** Mints a fresh anonymous session and returns its cookies; /saveImage is a SecuredAction. */
  private def anonSession(): Seq[Cookie] = {
    val resp = route(app, FakeRequest(GET, "/anonSignUp?url=%2F")).get
    status(resp) mustBe SEE_OTHER
    cookies(resp).toSeq
  }

  private def postCrop(session: Seq[Cookie], labelId: Int, lblType: String = labelType, b64: String = cropDataUrl) =
    route(
      app,
      FakeRequest(POST, "/saveImage")
        .withCookies(session: _*)
        .withJsonBody(Json.obj("label_id" -> labelId, "label_type" -> lblType, "b64" -> b64))
        .withCSRFToken
    ).get

  private def cropFileFor(labelId: Int): File = panoDataService.cropFile(labelId, labelType)

  /** Writes a stand-in for a preview built before the crop existed. */
  private def seedCachedPreview(labelId: Int): File = {
    val file = shareImageCache.fileFor(labelId)
    val _    = file.getParentFile.mkdirs()
    val _    = file.createNewFile()
    file
  }

  private def cleanUp(labelId: Int): Unit = {
    val _ = cropFileFor(labelId).delete()
    val _ = shareImageCache.fileFor(labelId).delete()
  }

  "POST /saveImage" should {
    "require a session, so crops can't be written by an unauthenticated caller" in {
      cleanUp(syntheticLabelId) // A run that died mid-test could have left one behind.
      val resp = route(
        app,
        FakeRequest(POST, "/saveImage")
          .withJsonBody(Json.obj("label_id" -> syntheticLabelId, "label_type" -> labelType, "b64" -> cropDataUrl))
          .withCSRFToken
      ).get

      // An unauthenticated write is answered 401 rather than bounced, so the client can mint a session and retry it
      // instead of having the submission swallowed by a followed redirect (ControllerUtils.anonSignupRedirect).
      status(resp) mustBe UNAUTHORIZED
      cropFileFor(syntheticLabelId).exists() mustBe false
    }

    "write the crop and drop the label's cached share preview (#4726)" in {
      cleanUp(syntheticLabelId)
      val preview = seedCachedPreview(syntheticLabelId)
      preview.exists() mustBe true

      try {
        val resp = postCrop(anonSession(), syntheticLabelId)

        status(resp) mustBe OK
        contentAsString(resp) must include(s"Got: crop_$syntheticLabelId")
        cropFileFor(syntheticLabelId).exists() mustBe true
        // The preview was built from a Street View still or the placeholder; the crop it stood in for has arrived,
        // so it must not survive to be served forever.
        preview.exists() mustBe false
      } finally cleanUp(syntheticLabelId)
    }

    "leave other labels' cached previews alone" in {
      cleanUp(syntheticLabelId)
      cleanUp(otherSyntheticLabelId)
      val otherPreview = seedCachedPreview(otherSyntheticLabelId)

      try {
        status(postCrop(anonSession(), syntheticLabelId)) mustBe OK
        otherPreview.exists() mustBe true
      } finally {
        cleanUp(syntheticLabelId)
        cleanUp(otherSyntheticLabelId)
      }
    }

    "reject an unknown label type without writing anything" in {
      // The label type becomes a filesystem path segment, so it is validated against the enum first.
      val resp = postCrop(anonSession(), syntheticLabelId, lblType = "../../etc")

      status(resp) mustBe BAD_REQUEST
      contentAsString(resp) must include("Invalid label type")
    }

    "reject a request with no JSON body" in {
      val resp = route(app, FakeRequest(POST, "/saveImage").withCookies(anonSession(): _*).withCSRFToken).get
      status(resp) mustBe BAD_REQUEST
    }
  }
}
