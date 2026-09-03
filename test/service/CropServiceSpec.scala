package service

import models.utils.{ImageUtils, MyPostgresProfile}
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.test.FakeRequest
import play.api.test.Helpers._
import play.api.{Application, Configuration, Environment}
import service.CropService.CropRunResult

import java.awt.image.BufferedImage
import java.io.File
import java.nio.file.{Files, StandardCopyOption}
import java.util.UUID
import javax.imageio.ImageIO
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}

/**
 * The crop reconciliation job end to end (#4865): seeded labels on a seeded pano whose image is in a temporary store,
 * one run, and the files and rows it leaves behind.
 *
 * Every media directory is pointed at a temp dir, so the run touches nothing real: every other label in the schema is
 * skipped as "no self-hosted image", which is also what makes the run cheap. The rows are committed rather than rolled
 * back — the job reads through its own connections — and deleted in afterAll under a prefix no real pano carries.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
// Mixin order matters: GuiceOneAppPerSuite must be rightmost so its run() wraps BeforeAndAfterAll's — otherwise
// afterAll's cleanup executes after the app (and its DB pool) has shut down and aborts the suite.
class CropServiceSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  private val prefix    = "CropServiceSpec-4865-"
  private val mediaRoot = Files.createTempDirectory("crop-service-spec").toFile

  /** The pano viewer's width cap, set below the synthetic pano's 1024 so the run has a derivative to write. */
  private val DerivativeMaxWidth = 512

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .configure(
        "cropped.image.directory"       -> new File(mediaRoot, "crops").getPath,
        "pano.images.directory"         -> new File(mediaRoot, "panos").getPath,
        "pano.derived.images.directory" -> new File(mediaRoot, "derived").getPath,
        "share.image.directory"         -> new File(mediaRoot, "share").getPath,
        "pano.derived.max-width"        -> DerivativeMaxWidth
      )
      .build()

  private lazy val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  implicit private lazy val ec: ExecutionContext = app.injector.instanceOf[ExecutionContext]
  // Play's test helpers need a real materializer to read a streamed (sendFile) body.
  implicit private lazy val mat: Materializer = app.materializer
  private lazy val cropService                = app.injector.instanceOf[CropService]
  private lazy val panoDataService            = app.injector.instanceOf[PanoDataService]
  private lazy val signingService             = app.injector.instanceOf[ImageSigningService]

  private def runDb[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private def generate(): CropRunResult = Await.result(cropService.generateMissingCrops(), 5.minutes)

  private val syntheticPano = new File("test/resources/crops/synthetic-pano.png")

  // Four panos: one with its image in the store, one without, one whose row claims another size, and one whose row
  // records no size at all.
  private val backedPanoId     = s"${prefix}backed"
  private val unbackedPanoId   = s"${prefix}unbacked"
  private val mismatchedPanoId = s"${prefix}mismatched"
  private val unrecordedPanoId = s"${prefix}unrecorded"

  /** What `seedLabel` wrote, so afterAll can delete exactly that. */
  private case class Seeded(labelId: Int, streetEdgeId: Int, auditTaskId: Int, missionId: Int, userId: String)

  private var seeded: Map[String, Seeded] = Map.empty

  // The run under test happens once, in beforeAll, and every case reads its result — rather than the first case
  // running it and the rest asserting on what it left, which passes vacuously for any case run on its own.
  private var beforeRun: Map[String, (Boolean, Option[Boolean])] = Map.empty
  private var firstRun: CropRunResult                            = CropRunResult(0, 0, 0, 0, 0, 0, 0, 0, 0)

  /** Puts the synthetic pano where `localBackupImageFile` resolves it for this city. */
  private def storePano(panoId: String): File = {
    val base = MediaDirs.cityDir(
      app.injector.instanceOf[Configuration],
      app.injector.instanceOf[Environment],
      "pano.images.directory"
    )
    val file = new File(new File(base, panoId.take(2)), s"$panoId.png")
    val _    = file.getParentFile.mkdirs()
    val _    = Files.copy(syntheticPano.toPath, file.toPath, StandardCopyOption.REPLACE_EXISTING)
    file
  }

  /**
   * Seeds the FK chain one label needs — user, street, audit task, mission, pano, label, label point — with explicit
   * MAX+1 ids, since the dev dumps insert rows without advancing the sequences.
   */
  private def seedLabel(panoId: String, recordedDims: Option[(Int, Int)], panoX: Int, panoY: Int): Seeded = {
    val userId         = UUID.randomUUID().toString
    val username       = prefix + userId.take(8)
    val recordedWidth  = recordedDims.map(_._1)
    val recordedHeight = recordedDims.map(_._2)
    runDb((for {
      _ <- sqlu"""INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)
                  VALUES ($userId, $username, ${username + "@test.invalid"})"""
      _ <- sqlu"""INSERT INTO user_stat (user_stat_id, user_id, meters_audited, high_quality, excluded)
                  VALUES ((SELECT COALESCE(MAX(user_stat_id), 0) + 1 FROM user_stat), $userId, 0, TRUE, FALSE)"""
      streetEdgeId <-
        sql"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
              VALUES ((SELECT COALESCE(MAX(street_edge_id), 0) + 1 FROM street_edge),
                      ST_SetSRID(ST_MakeLine(ST_MakePoint(0, 0), ST_MakePoint(0.0001, 0)), 4326),
                      0, 0, 0.0001, 0, 'residential', 'open')
              RETURNING street_edge_id""".as[Int].head
      auditTaskId <-
        sql"""INSERT INTO audit_task (audit_task_id, user_id, street_edge_id, completed, current_lat, current_lng)
              VALUES ((SELECT COALESCE(MAX(audit_task_id), 0) + 1 FROM audit_task),
                      $userId, $streetEdgeId, FALSE, 0, 0)
              RETURNING audit_task_id""".as[Int].head
      missionId <-
        sql"""INSERT INTO mission (mission_id, mission_type, user_id, completed, paid, skipped)
              VALUES ((SELECT COALESCE(MAX(mission_id), 0) + 1 FROM mission), 'audit', $userId, FALSE, FALSE, FALSE)
              RETURNING mission_id""".as[Int].head
      // has_backup deliberately NULL: the job, not the seed, is what should learn the image is there.
      _ <- sqlu"""INSERT INTO pano_data (pano_id, capture_date, source, width, height, copyright)
                  VALUES ($panoId, '2024-05', 'mapillary', $recordedWidth, $recordedHeight, 'spec-creator')"""
      labelId <-
        sql"""INSERT INTO label (label_id, audit_task_id, pano_id, label_type, temporary_label_id, mission_id,
                                 street_edge_id, user_id)
              VALUES ((SELECT COALESCE(MAX(label_id), 0) + 1 FROM label),
                      $auditTaskId, $panoId, 'CurbRamp', 1, $missionId, $streetEdgeId, $userId)
              RETURNING label_id""".as[Int].head
      _ <- sqlu"""INSERT INTO label_point (label_point_id, label_id, pano_x, pano_y, canvas_x, canvas_y, heading,
                                           pitch, zoom)
                  VALUES ((SELECT COALESCE(MAX(label_point_id), 0) + 1 FROM label_point),
                          $labelId, $panoX, $panoY, 360, 240, 0, 0, 1)"""
    } yield Seeded(labelId, streetEdgeId, auditTaskId, missionId, userId)).transactionally)
  }

  private def hasBackup(panoId: String): Option[Boolean] =
    runDb(sql"SELECT has_backup FROM pano_data WHERE pano_id = $panoId".as[Option[Boolean]].head)

  private def cropFile(panoId: String): File = panoDataService.cropFile(seeded(panoId).labelId, "CurbRamp")

  override def beforeAll(): Unit = {
    super.beforeAll()
    val _ = storePano(backedPanoId)
    val _ = storePano(mismatchedPanoId)
    val _ = storePano(unrecordedPanoId)
    seeded = Map(
      backedPanoId     -> seedLabel(backedPanoId, Some((1024, 512)), panoX = 512, panoY = 300),
      unbackedPanoId   -> seedLabel(unbackedPanoId, Some((1024, 512)), panoX = 512, panoY = 300),
      mismatchedPanoId -> seedLabel(mismatchedPanoId, Some((2048, 512)), panoX = 512, panoY = 300),
      unrecordedPanoId -> seedLabel(unrecordedPanoId, None, panoX = 512, panoY = 300)
    )
    beforeRun = seeded.keys.map(panoId => panoId -> (cropFile(panoId).exists(), hasBackup(panoId))).toMap
    firstRun = generate()
  }

  override def afterAll(): Unit = {
    try {
      // Reverse of the seed's FK order, by the ids the seed returned; a label a dead run left behind under the pano
      // prefix is caught by the pano-keyed deletes, since label.pano_id references pano_data.
      val prefixPattern = s"$prefix%"
      val _             = runDb(
        DBIO.seq(
          sqlu"""DELETE FROM label_point
                 WHERE label_id IN (SELECT label_id FROM label WHERE pano_id LIKE $prefixPattern)""",
          sqlu"DELETE FROM label WHERE pano_id LIKE $prefixPattern",
          sqlu"DELETE FROM pano_data WHERE pano_id LIKE $prefixPattern",
          DBIO.sequence(seeded.values.toSeq.map { s =>
            DBIO.seq(
              sqlu"DELETE FROM audit_task WHERE audit_task_id = ${s.auditTaskId}",
              sqlu"DELETE FROM mission WHERE mission_id = ${s.missionId}",
              sqlu"DELETE FROM street_edge WHERE street_edge_id = ${s.streetEdgeId}",
              sqlu"DELETE FROM user_stat WHERE user_id = ${s.userId}",
              sqlu"DELETE FROM sidewalk_login.sidewalk_user WHERE user_id = ${s.userId}"
            )
          })
        )
      )
      deleteRecursively(mediaRoot)
    } finally super.afterAll()
  }

  private def deleteRecursively(file: File): Unit = {
    Option(file.listFiles()).foreach(_.foreach(deleteRecursively))
    val _ = file.delete()
  }

  "CropService.generateMissingCrops" should {
    "cut a crop for the label whose pano is in the store, and learn that the pano is backed up" in {
      // The run had nothing to start from: no crop on disk, and a row that made no claim about a backup.
      beforeRun(backedPanoId) mustBe ((false, None))

      // The backed pano's label and the one whose row records no dimensions; the other two seeds are skipped.
      firstRun.cropsWritten mustBe 2
      firstRun.errors mustBe 0
      val crop = cropFile(backedPanoId)
      crop.exists() mustBe true
      // Exactly the window the geometry asks for at (512, 300) on a 1024x512 pano, which is far under the storage cap.
      val expected = CropGeometry.computeCropBox(512, 300, CropSizingRule.windowWidth(300, 512), 1024, 512)
      val image    = ImageIO.read(crop)
      (image.getWidth, image.getHeight) mustBe (expected.width, expected.height)
      hasBackup(backedPanoId) mustBe Some(true)
    }

    "leave the label whose pano has no self-hosted image alone" in {
      cropFile(unbackedPanoId).exists() mustBe false
      hasBackup(unbackedPanoId) mustBe None
    }

    "cut, but count separately, a label whose pano row records no dimensions to check its frame against" in {
      // Nothing here can confirm pano_x/pano_y were placed on the frame that was stored, so the crop is cut on that
      // assumption and the run says how often it had to make it — rather than reporting it as a verified crop.
      firstRun.dimsUnverified mustBe 1
      cropFile(unrecordedPanoId).exists() mustBe true
    }

    "skip, and count, a label whose pano row claims another size than the stored image" in {
      // Its positions are in a 2048-wide frame; cutting them from a 1024-wide image would mis-centre the crop.
      firstRun.dimsMismatch mustBe 1
      cropFile(mismatchedPanoId).exists() mustBe false
    }

    "write a display derivative for every stored pano wider than the viewer's cap" in {
      // Both stored panos are 1024 wide against a 512 cap; the derivative doesn't depend on the label being cut.
      val derivative = cropService.derivedImageFile(backedPanoId)
      derivative.exists() mustBe true
      val image = ImageIO.read(derivative)
      (image.getWidth, image.getHeight) mustBe (DerivativeMaxWidth, DerivativeMaxWidth / 2)
      cropService.derivedImageFile(mismatchedPanoId).exists() mustBe true
    }

    "do nothing on a second run" in {
      val crop       = cropFile(backedPanoId)
      val derivative = cropService.derivedImageFile(backedPanoId)
      val before     = (crop.lastModified(), crop.length(), derivative.lastModified(), derivative.length())

      val result = generate()

      result.cropsWritten mustBe 0
      result.derivativesWritten mustBe 0
      (crop.lastModified(), crop.length(), derivative.lastModified(), derivative.length()) mustBe before
    }

    "recut a derivative left at a width the configuration no longer asks for" in {
      // Standing in for a `pano.derived.max-width` change, which the previous case shows a presence test can't see.
      val derivative = cropService.derivedImageFile(backedPanoId)
      val stale      = new BufferedImage(DerivativeMaxWidth / 2, DerivativeMaxWidth / 4, BufferedImage.TYPE_INT_RGB)
      ImageUtils.writeJpeg(stale, derivative, CropService.DerivativeJpegQuality)

      val result = generate()

      result.derivativesWritten mustBe 1
      ImageIO.read(derivative).getWidth mustBe DerivativeMaxWidth
    }
  }

  "GET /backupImage/:panoId" should {
    "serve the derivative when there is one, and the native file otherwise" in {
      val url        = signingService.signedUrl(s"/backupImage/$backedPanoId")
      val derivative = cropService.derivedImageFile(backedPanoId)
      derivative.exists() mustBe true

      val withDerivative = route(app, FakeRequest(GET, url)).get
      status(withDerivative) mustBe OK
      contentType(withDerivative) mustBe Some("image/jpeg")
      contentAsBytes(withDerivative).length.toLong mustBe derivative.length()

      // Moved aside rather than deleted, and put back, so this case leaves the store as it found it.
      val moved = new File(s"${derivative.getPath}.moved")
      val _     = Files.move(derivative.toPath, moved.toPath)
      try {
        val native = route(app, FakeRequest(GET, url)).get
        status(native) mustBe OK
        contentType(native) mustBe Some("image/png")
        contentAsBytes(native).length.toLong mustBe syntheticPano.length()
      } finally {
        val _ = Files.move(moved.toPath, derivative.toPath)
      }
    }
  }
}
