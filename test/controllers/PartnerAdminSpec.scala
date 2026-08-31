package controllers

import models.partner.{Partner, PartnerTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.Files.SingletonTemporaryFileCreator
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Cookie, MultipartFormData}
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._
import slick.dbio.DBIO
import util.{AnonSession, RoleSession}

import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.time.OffsetDateTime
import javax.imageio.ImageIO
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Functional tests for the community-partner logo surface (#4516): the admin CRUD under /adminapi, the Owner-only
 * global scope, the public /partnerLogo bytes, and the landing page's rendering of both.
 *
 * The scope rules are the part worth pinning hardest: the partner table lives in the shared sidewalk_login schema,
 * so a hole here lets one city's admin edit what every other deployment's landing page shows. Rows created by the
 * suite are deleted in afterAll so repeated runs against a shared dev DB don't accumulate logos.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class PartnerAdminSpec extends PlaySpec with RoleSession with GuiceOneAppPerSuite with AnonSession {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // AnonSession mints one session per call and the limiter is per-IP; every suite in a run shares loopback.
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  implicit lazy val mat: Materializer = app.materializer

  private val dbConfig     = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private val partnerTable = app.injector.instanceOf[PartnerTable]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  private lazy val visitorCookies: Seq[Cookie] = sessionAs("Registered")
  private lazy val adminCookies: Seq[Cookie]   = sessionAs("Administrator")
  private lazy val ownerCookies: Seq[Cookie]   = sessionAs("Owner")

  /** Every partner row this suite created, cleaned up afterwards so the shared DB doesn't accumulate logos. */
  private var createdIds: List[Int] = Nil

  override def afterAll(): Unit = {
    // In a `try` because RoleSession's demotion rides super.afterAll; leaving a promoted account in the shared login
    // schema would be worse than leaving rows behind.
    try {
      if (createdIds.nonEmpty) {
        val _ = run(partnerTable.partners.filter(_.partnerId.inSet(createdIds)).delete)
      }
    } finally super.afterAll()
  }

  /** A real PNG upload part: RGBA (so alpha survival is checkable) and wide, like the wordmarks partners send. */
  private def pngFilePart(
      width: Int = 1200,
      height: Int = 300
  ): MultipartFormData.FilePart[play.api.libs.Files.TemporaryFile] = {
    val img  = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB)
    val temp = SingletonTemporaryFileCreator.create("partner-spec", ".png")
    ImageIO.write(img, "png", temp.path.toFile) mustBe true
    MultipartFormData.FilePart(key = "logo", filename = "partner-spec.png", contentType = Some("image/png"), ref = temp)
  }

  /** Bytes that claim to be a PNG but aren't an image at all — the sniffer, not the filename, must decide. */
  private def bogusFilePart(): MultipartFormData.FilePart[play.api.libs.Files.TemporaryFile] = {
    val temp = SingletonTemporaryFileCreator.create("partner-bogus", ".png")
    java.nio.file.Files.write(temp.path, "not an image".getBytes)
    MultipartFormData.FilePart(key = "logo", filename = "bogus.png", contentType = Some("image/png"), ref = temp)
  }

  /**
   * A PNG with an intact header but truncated pixel data: the header sniff passes it, but the full decode throws —
   * the class of file (with e.g. CMYK JPEGs) that must come back 400, not 500.
   */
  private def truncatedPngFilePart(): MultipartFormData.FilePart[play.api.libs.Files.TemporaryFile] = {
    val img = new BufferedImage(400, 200, BufferedImage.TYPE_INT_RGB)
    val rng = new scala.util.Random(4516) // Noise, so the pixel data far outweighs the header and truncation hits it.
    for {
      x <- 0 until 400
      y <- 0 until 200
    } img.setRGB(x, y, rng.nextInt())
    val baos = new java.io.ByteArrayOutputStream()
    ImageIO.write(img, "png", baos) mustBe true
    val bytes = baos.toByteArray
    val temp  = SingletonTemporaryFileCreator.create("partner-truncated", ".png")
    java.nio.file.Files.write(temp.path, bytes.take(bytes.length / 2))
    MultipartFormData.FilePart(key = "logo", filename = "truncated.png", contentType = Some("image/png"), ref = temp)
  }

  private def multipartBody(
      dataParts: Map[String, Seq[String]],
      files: Seq[MultipartFormData.FilePart[play.api.libs.Files.TemporaryFile]]
  ): MultipartFormData[play.api.libs.Files.TemporaryFile] =
    MultipartFormData(dataParts = dataParts, files = files, badParts = Nil)

  private def postPartner(
      session: Seq[Cookie],
      path: String,
      name: String,
      url: Option[String] = None,
      altText: Option[String] = None,
      files: Seq[MultipartFormData.FilePart[play.api.libs.Files.TemporaryFile]] = Seq(pngFilePart())
  ) = {
    val parts = Map("name" -> Seq(name)) ++ url.map(u => "url" -> Seq(u)) ++ altText.map(a => "alt_text" -> Seq(a))
    route(
      app,
      FakeRequest(POST, path)
        .withHeaders(XHR)
        .withCookies(session: _*)
        .withMultipartFormDataBody(multipartBody(parts, files))
        .withCSRFToken
    ).get
  }

  /** Creates a partner and remembers its id for cleanup; fails the test if creation didn't succeed. */
  private def createPartner(session: Seq[Cookie], path: String, name: String, url: Option[String] = None): Int = {
    val resp = postPartner(session, path, name, url)
    status(resp) mustBe OK
    val id = (contentAsJson(resp) \ "partner" \ "partner_id").as[Int]
    createdIds ::= id
    id
  }

  private def putReorder(session: Seq[Cookie], path: String, ids: Seq[Int]) =
    route(
      app,
      FakeRequest(PUT, path)
        .withHeaders(XHR)
        .withCookies(session: _*)
        .withJsonBody(Json.obj("partner_ids" -> ids))
        .withCSRFToken
    ).get

  private def getAdminLists(session: Seq[Cookie]): JsObject =
    contentAsJson(route(app, FakeRequest(GET, "/adminapi/partners").withHeaders(XHR).withCookies(session: _*)).get)
      .as[JsObject]

  private def landingBody(): String = {
    val resp = route(app, FakeRequest(GET, "/")).get
    status(resp) mustBe OK
    contentAsString(resp)
  }

  "the partner admin surface" should {
    "refuse a signed-in visitor, naming the role it wants" in {
      // The anonymous checks in RouteAuthPostureSpec cannot tell WithAdmin from WithOwner; this can.
      Seq(GET -> "/admin/partners", GET -> "/adminapi/partners").foreach { case (method, path) =>
        val resp = route(app, FakeRequest(method, path).withHeaders(XHR).withCookies(visitorCookies: _*)).get
        status(resp) mustBe FORBIDDEN
        contentAsString(resp) must include("Administrator")
      }
    }

    "refuse an Administrator on the Owner-only global routes" in {
      val resp = postPartner(adminCookies, "/adminapi/globalPartners", "Global Test Partner")
      status(resp) mustBe FORBIDDEN
      contentAsString(resp) must include("Owner")
      status(putReorder(adminCookies, "/adminapi/globalPartners/order", Seq.empty)) mustBe FORBIDDEN
    }

    "serve the page to an administrator, with the containers its client fills" in {
      val resp = route(app, FakeRequest(GET, "/admin/partners").withCookies(adminCookies: _*)).get
      status(resp) mustBe OK
      val body = contentAsString(resp)
      Seq("partners-city-list", "partners-global-list", "partners-status").foreach(id => body must include(id))
    }
  }

  "creating and serving a partner" should {
    "round-trip a city partner onto the landing page, preserving PNG transparency" in {
      val id =
        createPartner(adminCookies, "/adminapi/partners", "Partner Spec City Org", Some("https://example.org/city"))

      val lists = getAdminLists(adminCookies)
      (lists \ "is_owner").as[Boolean] mustBe false
      (lists \ "city_partners").as[Seq[JsObject]].map(p => (p \ "partner_id").as[Int]) must contain(id)

      val logoResp = route(app, FakeRequest(GET, s"/partnerLogo/$id")).get
      status(logoResp) mustBe OK
      contentType(logoResp) mustBe Some("image/png")
      header("Cache-Control", logoResp).value must include("immutable")
      val decoded = ImageIO.read(new ByteArrayInputStream(contentAsBytes(logoResp).toArray))
      decoded.getColorModel.hasAlpha mustBe true
      // The 1200px upload must come back downscaled to the 800px storage edge.
      decoded.getWidth mustBe 800

      val body = landingBody()
      body must include("Partner Spec City Org")
      body must include(s"/partnerLogo/$id")
    }

    "let an Owner create a global partner that renders before city partners" in {
      val cityIdCreated   = createPartner(adminCookies, "/adminapi/partners", "Partner Spec City Two")
      val globalIdCreated = createPartner(ownerCookies, "/adminapi/globalPartners", "Partner Spec Global Org")

      val lists = getAdminLists(ownerCookies)
      (lists \ "is_owner").as[Boolean] mustBe true
      (lists \ "global_partners").as[Seq[JsObject]].map(p => (p \ "partner_id").as[Int]) must
        contain(globalIdCreated)

      val body = landingBody()
      body.indexOf(s"/partnerLogo/$globalIdCreated") must be > 0
      body.indexOf(s"/partnerLogo/$cityIdCreated") must be > 0
      body.indexOf(s"/partnerLogo/$globalIdCreated") must be < body.indexOf(s"/partnerLogo/$cityIdCreated")
    }

    "404 an unknown logo id" in {
      status(route(app, FakeRequest(GET, "/partnerLogo/999999999")).get) mustBe NOT_FOUND
    }

    "version logo URLs at millisecond granularity and answer revalidation with 304" in {
      val id = createPartner(adminCookies, "/adminapi/partners", "Partner Spec Etag Org")

      val logoUrl = (getAdminLists(adminCookies) \ "city_partners")
        .as[Seq[JsObject]]
        .find(p => (p \ "partner_id").as[Int] == id)
        .value
        .\("logo_url")
        .as[String]
      val version = logoUrl.split("\\?v=").last
      // Millisecond, not second, granularity: two logo swaps moments apart must mint distinct immutable URLs.
      version.toLong must be > 1000000000000L

      val first = route(app, FakeRequest(GET, s"/partnerLogo/$id?v=$version")).get
      status(first) mustBe OK
      val etag = header("ETag", first).value
      etag mustBe s""""$version""""

      val revalidated = route(app, FakeRequest(GET, s"/partnerLogo/$id").withHeaders("If-None-Match" -> etag)).get
      status(revalidated) mustBe NOT_MODIFIED
      header("Cache-Control", revalidated).value must include("immutable")

      // A stale or garbage version must never 404 or serve mismatched bytes — it reads fresh from the DB.
      status(route(app, FakeRequest(GET, s"/partnerLogo/$id?v=12345")).get) mustBe OK
    }
  }

  "scope enforcement on update and delete" should {
    "hide global rows from an Administrator, exactly like a missing id" in {
      val globalId = createPartner(ownerCookies, "/adminapi/globalPartners", "Partner Spec Global Guarded")
      val update   = route(
        app,
        FakeRequest(PUT, s"/adminapi/partners/$globalId")
          .withHeaders(XHR)
          .withCookies(adminCookies: _*)
          .withMultipartFormDataBody(multipartBody(Map("name" -> Seq("hijacked")), Seq.empty))
          .withCSRFToken
      ).get
      status(update) mustBe NOT_FOUND
      val delete =
        route(
          app,
          FakeRequest(DELETE, s"/adminapi/partners/$globalId")
            .withHeaders(XHR)
            .withCookies(adminCookies: _*)
            .withCSRFToken
        ).get
      status(delete) mustBe NOT_FOUND
    }

    "hide another city's rows even from an Owner" in {
      // Seeded directly: the API can never create a row for another city, which is exactly the point.
      val now       = OffsetDateTime.now
      val ownerId   = userIdOf(ownerCookies)
      val otherCity = run(
        partnerTable.insert(
          Partner(
            0,
            Some("partner-spec-other-city"),
            "Partner Spec Foreign",
            None,
            None,
            0,
            Array[Byte](1, 2, 3),
            "image/png",
            1,
            1,
            now,
            now,
            ownerId,
            ownerId
          )
        )
      ).partnerId
      createdIds ::= otherCity
      val delete =
        route(
          app,
          FakeRequest(DELETE, s"/adminapi/partners/$otherCity")
            .withHeaders(XHR)
            .withCookies(ownerCookies: _*)
            .withCSRFToken
        ).get
      status(delete) mustBe NOT_FOUND
    }

    "let an Owner update a global row" in {
      val globalId = createPartner(ownerCookies, "/adminapi/globalPartners", "Partner Spec Global Editable")
      val update   = route(
        app,
        FakeRequest(PUT, s"/adminapi/partners/$globalId")
          .withHeaders(XHR)
          .withCookies(ownerCookies: _*)
          .withMultipartFormDataBody(
            multipartBody(
              Map("name" -> Seq("Partner Spec Global Renamed"), "url" -> Seq("https://example.org/new")),
              Seq.empty
            )
          )
          .withCSRFToken
      ).get
      status(update) mustBe OK
      val names = (getAdminLists(ownerCookies) \ "global_partners").as[Seq[JsObject]].map(p => (p \ "name").as[String])
      names must contain("Partner Spec Global Renamed")
      // The landing list is cached in-process; a write must invalidate it so the admin sees the change immediately.
      landingBody() must include("Partner Spec Global Renamed")
    }
  }

  "reordering" should {
    "apply a permutation of a scope's ids and refuse anything else" in {
      val first  = createPartner(adminCookies, "/adminapi/partners", "Partner Spec Order A")
      val second = createPartner(adminCookies, "/adminapi/partners", "Partner Spec Order B")

      def cityOrder(): Seq[Int] =
        (getAdminLists(adminCookies) \ "city_partners").as[Seq[JsObject]].map(p => (p \ "partner_id").as[Int])

      val reversed = cityOrder().reverse
      status(putReorder(adminCookies, "/adminapi/partners/order", reversed)) mustBe OK
      cityOrder() mustBe reversed
      cityOrder().indexOf(second) must be < cityOrder().indexOf(first)

      // A list missing a row (or carrying a foreign one) is refused whole.
      val incomplete = putReorder(adminCookies, "/adminapi/partners/order", reversed.tail)
      status(incomplete) mustBe BAD_REQUEST
      (contentAsJson(incomplete) \ "error").as[String] mustBe "bad_order"
    }
  }

  "upload validation" should {
    "reject a blank name, a non-http URL, a missing logo, and bytes that aren't an image" in {
      val blankName = postPartner(adminCookies, "/adminapi/partners", "   ")
      status(blankName) mustBe BAD_REQUEST
      (contentAsJson(blankName) \ "error").as[String] mustBe "name_invalid"

      val badUrl =
        postPartner(adminCookies, "/adminapi/partners", "Partner Spec Bad Url", url = Some("javascript:alert(1)"))
      status(badUrl) mustBe BAD_REQUEST
      (contentAsJson(badUrl) \ "error").as[String] mustBe "url_invalid"

      val noLogo = postPartner(adminCookies, "/adminapi/partners", "Partner Spec No Logo", files = Seq.empty)
      status(noLogo) mustBe BAD_REQUEST
      (contentAsJson(noLogo) \ "error").as[String] mustBe "logo_required"

      val bogus = postPartner(adminCookies, "/adminapi/partners", "Partner Spec Bogus", files = Seq(bogusFilePart()))
      status(bogus) mustBe BAD_REQUEST
      (contentAsJson(bogus) \ "error").as[String] mustBe "logo_invalid"

      val truncated =
        postPartner(adminCookies, "/adminapi/partners", "Partner Spec Truncated", files = Seq(truncatedPngFilePart()))
      status(truncated) mustBe BAD_REQUEST
      (contentAsJson(truncated) \ "error").as[String] mustBe "logo_invalid"
    }
  }

  "the landing page" should {
    "always carry the created-by strip's creator logos and never the retired hardcoded logos" in {
      val body = landingBody()
      body must include("creators-title")
      body must include("partners-credit")
      body must include("makeability-lab-logo")
      body must include("uw-logo")
      body must include("uic-idhd-logo")
      body must not include "MakeabilityLogo.png"
      body must not include "collaborators-container"
    }
  }
}
