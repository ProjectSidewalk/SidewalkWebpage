package controllers

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api.*
import org.apache.pekko.stream.Materializer
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsValue
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import play.api.{Application, Configuration, Environment}
import service.{ImageSigningService, MediaDirs, PanoDataService}
import util.SidewalkSpec

import java.io.File
import java.nio.file.{Files, StandardCopyOption}
import scala.concurrent.Await
import scala.concurrent.duration.*

/**
 * `GET /backupImage/:panoId/metadata` over HTTP (#5183): every refusal is a 404, and each one says which precondition
 * failed — no stored image, no pano_data row, or a row missing named columns — instead of reporting a missing image
 * for a pano whose image is sitting in the store.
 *
 * The pano store is pointed at a temp dir and the seeded rows carry a prefix no real pano uses; both are removed in
 * afterAll. No Referer is sent, which `refererAllowed` accepts, as it does for any non-browser client.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
// Mixin order matters: GuiceOneAppPerSuite must be rightmost so its run() wraps BeforeAndAfterAll's — otherwise
// afterAll's cleanup executes after the app (and its DB pool) has shut down and aborts the suite.
class BackupImageMetadataSpec extends SidewalkSpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  private val prefix    = "BackupImageMetadataSpec-5183-"
  private val mediaRoot = Files.createTempDirectory("backup-image-metadata-spec").toFile

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .configure(
        "cropped.image.directory" -> File(mediaRoot, "crops").getPath,
        "pano.images.directory"   -> File(mediaRoot, "panos").getPath,
        "share.image.directory"   -> File(mediaRoot, "share").getPath
      )
      .build()

  private lazy val dbConfig        = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private given mat: Materializer  = app.materializer
  private lazy val panoDataService = app.injector.instanceOf[PanoDataService]
  private lazy val signingService  = app.injector.instanceOf[ImageSigningService]

  private def runDb[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val syntheticPano = File("test/resources/crops/synthetic-pano.png")

  // One pano per outcome. "Complete" is the only one the viewer can use; the rest each fail one precondition.
  private val completePanoId   = s"${prefix}complete"
  private val noPitchPanoId    = s"${prefix}nopitch"
  private val manyMissingId    = s"${prefix}manymissing"
  private val noRowPanoId      = s"${prefix}norow"
  private val noFilePanoId     = s"${prefix}nofile"
  private val nothingAtAllId   = s"${prefix}nothing"
  private val allSeededPanoIds = Seq(completePanoId, noPitchPanoId, manyMissingId, noRowPanoId, noFilePanoId)

  /** Puts the synthetic pano where `localBackupImageFile` looks for this id. */
  private def storePano(panoId: String): Unit = {
    val base = MediaDirs.cityDir(
      app.injector.instanceOf[Configuration],
      app.injector.instanceOf[Environment],
      "pano.images.directory"
    )
    val file = File(File(base, panoId.take(2)), s"$panoId.png")
    val _    = file.getParentFile.mkdirs()
    val _    = Files.copy(syntheticPano.toPath, file.toPath, StandardCopyOption.REPLACE_EXISTING)
  }

  /** A pano_data row with every viewer-required column set, except those passed as None. */
  private def seedRow(
      panoId: String,
      width: Option[Int] = Some(1024),
      lat: Option[Double] = Some(47.6),
      cameraPitch: Option[Double] = Some(1.5)
  ): Unit = {
    val _ = runDb(
      sqlu"""INSERT INTO pano_data (pano_id, capture_date, source, width, height, lat, lng, camera_heading,
                                    camera_pitch, expired)
             VALUES ($panoId, '2024-05', 'mapillary', $width, 512, $lat, -122.3, 90.0, $cameraPitch, TRUE)"""
    )
  }

  override def beforeAll(): Unit = {
    super.beforeAll()
    // A dead earlier run may have left rows behind under the prefix.
    val _ = runDb(sqlu"DELETE FROM pano_data WHERE pano_id LIKE ${prefix + "%"}")
    Seq(completePanoId, noPitchPanoId, manyMissingId, noRowPanoId).foreach(storePano)
    seedRow(completePanoId)
    seedRow(noPitchPanoId, cameraPitch = None)
    seedRow(manyMissingId, width = None, lat = None, cameraPitch = None)
    seedRow(noFilePanoId)
  }

  override def afterAll(): Unit = {
    try {
      val _ = runDb(sqlu"DELETE FROM pano_data WHERE pano_id LIKE ${prefix + "%"}")
      deleteRecursively(mediaRoot)
    } finally super.afterAll()
  }

  private def deleteRecursively(file: File): Unit = {
    Option(file.listFiles()).foreach(_.foreach(deleteRecursively))
    val _ = file.delete()
  }

  private def getMetadata(panoId: String) = route(app, FakeRequest(GET, s"/backupImage/$panoId/metadata")).get

  "GET /backupImage/:panoId/metadata" should {
    "serve the payload when the file is stored and the row is complete" in {
      val res = getMetadata(completePanoId)
      status(res) mustBe OK
      val json: JsValue = contentAsJson(res)
      (json \ "pano_id").as[String] mustBe completePanoId
      (json \ "camera_pitch").as[Double] mustBe 1.5
      (json \ "image_url").as[String] must startWith(s"/backupImage/$completePanoId?")
    }

    "say there is no stored image when there is neither a file nor a row" in {
      val res = getMetadata(nothingAtAllId)
      status(res) mustBe NOT_FOUND
      contentAsString(res) must include("No stored image")
      contentAsString(res) must not include "pano_data"
    }

    "name camera_pitch, not a missing image, when the file is stored but the row lacks camera_pitch" in {
      // The issue's case: an AI-submitted Mapillary pano whose image is in the store.
      val res  = getMetadata(noPitchPanoId)
      val body = contentAsString(res)
      status(res) mustBe NOT_FOUND
      body must include("cannot be served")
      body must include("pano_data is missing camera_pitch.")
      body must not include "No stored image"
      body must not include "No backup image found"
    }

    "list every missing column, in a fixed order" in {
      val res = getMetadata(manyMissingId)
      status(res) mustBe NOT_FOUND
      contentAsString(res) must include("pano_data is missing width, lat, camera_pitch.")
    }

    "say the row is missing when the file is stored but pano_data has no row for it" in {
      val res = getMetadata(noRowPanoId)
      status(res) mustBe NOT_FOUND
      contentAsString(res) must include("no pano_data row")
      contentAsString(res) must not include "No stored image"
    }

    "say there is no stored image when only the row exists, since the file is checked first" in {
      val res = getMetadata(noFilePanoId)
      status(res) mustBe NOT_FOUND
      contentAsString(res) must include("No stored image")
      contentAsString(res) must not include "pano_data is missing"
    }
  }

  "PanoDataService.getLocalBackupImage" should {
    "stay a gate: usable only when the file and a complete row are both there (#4804)" in {
      def gate(panoId: String) = Await.result(panoDataService.getLocalBackupImage(panoId), 30.seconds)
      gate(completePanoId).map(_.panoId) mustBe Some(completePanoId)
      (allSeededPanoIds.filterNot(_ == completePanoId) :+ nothingAtAllId).foreach { panoId =>
        withClue(panoId) { gate(panoId) mustBe None }
      }
    }
  }

  "GET /backupImage/:panoId" should {
    "serve a stored image whose row lacks camera_pitch, since only the viewer needs the metadata" in {
      val url = signingService.signedUrl(s"/backupImage/$noPitchPanoId")
      val res = route(app, FakeRequest(GET, url)).get
      status(res) mustBe OK
      contentType(res) mustBe Some("image/png")
    }
  }
}
