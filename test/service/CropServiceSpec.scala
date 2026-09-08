package service

import models.label.{CropSource, LabelCrop, LabelCropTable}
import models.utils.{ImageUtils, MyPostgresProfile}
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.Materializer
import org.scalatest.{BeforeAndAfterAll, OptionValues}
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
import java.time.OffsetDateTime
import java.util.UUID
import javax.imageio.ImageIO
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}
import scala.util.{Failure, Try}

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
class CropServiceSpec extends PlaySpec with BeforeAndAfterAll with OptionValues with GuiceOneAppPerSuite {

  private val prefix    = "CropServiceSpec-4865-"
  private val mediaRoot = Files.createTempDirectory("crop-service-spec").toFile

  /** The pano viewer's width cap, set below the synthetic pano's 1024 so the run has a pano to downscale. */
  private val DownscaledMaxWidth = 512

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .configure(
        "cropped.image.directory"   -> new File(mediaRoot, "crops").getPath,
        "pano.images.directory"     -> new File(mediaRoot, "panos").getPath,
        "share.image.directory"     -> new File(mediaRoot, "share").getPath,
        "pano.downscaled.max-width" -> DownscaledMaxWidth
      )
      .build()

  private lazy val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  implicit private lazy val ec: ExecutionContext = app.injector.instanceOf[ExecutionContext]
  // Play's test helpers need a real materializer to read a streamed (sendFile) body.
  implicit private lazy val mat: Materializer = app.materializer
  private lazy val cropService                = app.injector.instanceOf[CropService]
  private lazy val panoDataService            = app.injector.instanceOf[PanoDataService]
  private lazy val panoDataTable              = app.injector.instanceOf[models.pano.PanoDataTable]
  private lazy val labelCropTable             = app.injector.instanceOf[LabelCropTable]
  private lazy val shareImageCache            = app.injector.instanceOf[ShareImageCache]
  private lazy val signingService             = app.injector.instanceOf[ImageSigningService]

  private def runDb[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private def generate(): CropRunResult = Await.result(cropService.generateMissingCrops(), 5.minutes)

  private val syntheticPano = new File("test/resources/crops/synthetic-pano.png")

  /** The synthetic pano's size, and the size the narrow variant is stored at — under the cap, so never downscaled. */
  private val PanoW   = 1024
  private val PanoH   = 512
  private val NarrowW = 256
  private val NarrowH = 128

  // One label each, on panos that between them reach every branch of a run: in the store or not; a row that claims
  // another size, or none; an excluded user's; a pano_y off the image; a label near a pole; a second label type; a
  // crop that already exists; and a pano narrow enough to serve natively.
  private val backedPanoId      = s"${prefix}backed"
  private val unbackedPanoId    = s"${prefix}unbacked"
  private val mismatchedPanoId  = s"${prefix}mismatched"
  private val unrecordedPanoId  = s"${prefix}unrecorded"
  private val excludedPanoId    = s"${prefix}excluded"
  private val outOfFramePanoId  = s"${prefix}outofframe"
  private val polePanoId        = s"${prefix}pole"
  private val obstaclePanoId    = s"${prefix}obstacle"
  private val preexistingPanoId = s"${prefix}preexisting"
  private val narrowPanoId      = s"${prefix}narrow"

  /** A downscaled copy with no pano behind it at all: neither a row nor a native file. */
  private val orphanPanoId = s"${prefix}orphan"

  // Crops that exist before the run with no label_crop row, one per way the reconcile pass tells the writers apart
  // (#2660): a 1440x960 file where the job's window would be smaller (the size decides: a snapshot); a file of
  // exactly the job's window size (the size decides: a window); and three 1440x960 files on a pano wide enough that
  // the job's window would also be stored at 1440x960, where the size cannot decide and the label's age or its AI
  // authorship does. Plus one nothing can classify: no frame anywhere to recompute the window from.
  private val snapshotPanoId     = s"${prefix}snapshot"
  private val windowPanoId       = s"${prefix}window"
  private val ambiguousOldPanoId = s"${prefix}ambiguous-old"
  private val ambiguousNewPanoId = s"${prefix}ambiguous-new"
  private val ambiguousAiPanoId  = s"${prefix}ambiguous-ai"
  private val unresolvedPanoId   = s"${prefix}unresolved"

  // Two crops the pass must refuse rather than resolve: one the size alone would call a snapshot, on a label no
  // browser ever had; and one whose pano_y is off the image, which no window can register a marker in.
  private val snapshotAiPanoId   = s"${prefix}snapshot-ai"
  private val offFrameCropPanoId = s"${prefix}offframe-crop"

  /** A pano wide enough that the 90-degree cap on a near-field window still exceeds the 1440-px storage cap. */
  private val WideW = 8192
  private val WideH = 4096

  /** A label far enough below the horizon of the wide pano for the rule to ask for its widest window. */
  private val WideY = 2900

  /** What `seedLabel` wrote, so afterAll can delete exactly that. */
  private case class Seeded(
      labelId: Int,
      labelType: String,
      streetEdgeId: Int,
      auditTaskId: Int,
      missionId: Int,
      userId: String
  )

  private var seeded: Map[String, Seeded] = Map.empty

  // The run under test happens once, in beforeAll, and every case reads its result — rather than the first case
  // running it and the rest asserting on what it left, which passes vacuously for any case run on its own.
  private var beforeRun: Map[String, (Boolean, Option[Boolean])] = Map.empty
  private var firstRun: CropRunResult                            = CropRunResult(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)

  /** Where `localBackupImageFile` resolves a pano for this city. */
  private def storeFile(panoId: String): File = {
    val base = MediaDirs.cityDir(
      app.injector.instanceOf[Configuration],
      app.injector.instanceOf[Environment],
      "pano.images.directory"
    )
    val file = new File(new File(base, panoId.take(2)), s"$panoId.png")
    val _    = file.getParentFile.mkdirs()
    file
  }

  /** Puts the synthetic pano in the store under this id. */
  private def storePano(panoId: String): File = {
    val file = storeFile(panoId)
    val _    = Files.copy(syntheticPano.toPath, file.toPath, StandardCopyOption.REPLACE_EXISTING)
    file
  }

  /** Puts a 256x128 rendering of the synthetic pano in the store: a pano the viewer can take as it is. */
  private def storeNarrowPano(panoId: String): File = {
    val file  = storeFile(panoId)
    val small = new BufferedImage(NarrowW, NarrowH, BufferedImage.TYPE_INT_RGB)
    val g     = small.createGraphics()
    val _     = g.drawImage(ImageIO.read(syntheticPano), 0, 0, NarrowW, NarrowH, null)
    g.dispose()
    ImageUtils.writePng(small, file)
    file
  }

  /** A downscaled copy of the size the cap asks for, as the job would have left it. */
  private def plantDownscaled(panoId: String): File = {
    val file = cropService.downscaledImageFile(panoId)
    val _    = file.getParentFile.mkdirs()
    val img  = new BufferedImage(DownscaledMaxWidth, DownscaledMaxWidth / 2, BufferedImage.TYPE_INT_RGB)
    ImageUtils.writeJpeg(img, file, CropService.DownscaledJpegQuality)
    file
  }

  /**
   * Seeds the FK chain one label needs — user, street, audit task, mission, pano, label, label point — with explicit
   * MAX+1 ids, since the dev dumps insert rows without advancing the sequences.
   */
  private def seedLabel(
      panoId: String,
      recordedDims: Option[(Int, Int)],
      panoX: Int,
      panoY: Int,
      excluded: Boolean = false,
      labelType: String = "CurbRamp",
      createdDaysAgo: Int = 0,
      ai: Boolean = false
  ): Seeded = {
    val userId         = UUID.randomUUID().toString
    val username       = prefix + userId.take(8)
    val recordedWidth  = recordedDims.map(_._1)
    val recordedHeight = recordedDims.map(_._2)
    val timeCreated    = OffsetDateTime.now.minusDays(createdDaysAgo.toLong)
    runDb((for {
      _ <- sqlu"""INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)
                  VALUES ($userId, $username, ${username + "@test.invalid"})"""
      _ <- sqlu"""INSERT INTO user_stat (user_stat_id, user_id, meters_audited, high_quality, excluded)
                  VALUES ((SELECT COALESCE(MAX(user_stat_id), 0) + 1 FROM user_stat), $userId, 0, TRUE, $excluded)"""
      // Only the AI labeler gets a role row: the reconcile pass must classify a user with no role row too.
      _ <-
        if (ai) sqlu"INSERT INTO sidewalk_login.user_role (user_id, role) VALUES ($userId, 'AI'::sidewalk_login.role)"
        else DBIO.successful(0)
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
                                 street_edge_id, user_id, time_created)
              VALUES ((SELECT COALESCE(MAX(label_id), 0) + 1 FROM label),
                      $auditTaskId, $panoId, $labelType::label_type, 1, $missionId, $streetEdgeId, $userId,
                      $timeCreated)
              RETURNING label_id""".as[Int].head
      _ <- sqlu"""INSERT INTO label_point (label_point_id, label_id, pano_x, pano_y, canvas_x, canvas_y, heading,
                                           pitch, zoom)
                  VALUES ((SELECT COALESCE(MAX(label_point_id), 0) + 1 FROM label_point),
                          $labelId, $panoX, $panoY, 360, 240, 0, 0, 1)"""
    } yield Seeded(labelId, labelType, streetEdgeId, auditTaskId, missionId, userId)).transactionally)
  }

  private def hasBackup(panoId: String): Option[Boolean] =
    runDb(sql"SELECT has_backup FROM pano_data WHERE pano_id = $panoId".as[Option[Boolean]].head)

  private def cropFile(panoId: String): File = {
    val s = seeded(panoId)
    panoDataService.cropFile(s.labelId, s.labelType)
  }

  /** The window the geometry asks for at a label's position, to derive what the run should have counted. */
  private def boxFor(panoX: Int, panoY: Int, w: Int, h: Int): CropGeometry.CropBox =
    CropGeometry.computeCropBox(panoX.toDouble, panoY.toDouble, CropSizingRule.windowWidth(panoY.toDouble, w, h), w, h)

  /** The label's `label_crop` row, when the run (or `recordExploreFrameCrop`) has written one. */
  private def labelCrop(panoId: String): Option[LabelCrop] = runDb(labelCropTable.get(seeded(panoId).labelId))

  /** Writes a blank PNG of the given size as the label's crop, as a writer before this table would have left it. */
  private def plantCrop(panoId: String, width: Int, height: Int): File = {
    val file = cropFile(panoId)
    val _    = file.getParentFile.mkdirs()
    ImageUtils.writePng(new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), file)
    file
  }

  /** A stand-in for a share preview composited before the crop's provenance was known. */
  private def plantSharePreview(panoId: String): File = {
    val file = shareImageCache.fileFor(seeded(panoId).labelId)
    val _    = file.getParentFile.mkdirs()
    val _    = file.createNewFile()
    file
  }

  /** A stand-in for the crop the browser uploads at labeling time: tiny, so a recut is unmistakable. */
  private val preexistingCropBytes: Array[Byte] = {
    val tmp = File.createTempFile("preexisting", ".png")
    try {
      ImageUtils.writePng(new BufferedImage(10, 10, BufferedImage.TYPE_INT_RGB), tmp)
      Files.readAllBytes(tmp.toPath)
    } finally { val _ = tmp.delete() }
  }

  override def beforeAll(): Unit = {
    super.beforeAll()
    Seq(backedPanoId, mismatchedPanoId, unrecordedPanoId, excludedPanoId, outOfFramePanoId, polePanoId, obstaclePanoId,
      preexistingPanoId).foreach(storePano)
    val _ = storeNarrowPano(narrowPanoId)
    seeded = Map(
      backedPanoId     -> seedLabel(backedPanoId, Some((PanoW, PanoH)), panoX = 512, panoY = 300),
      unbackedPanoId   -> seedLabel(unbackedPanoId, Some((PanoW, PanoH)), panoX = 512, panoY = 300),
      mismatchedPanoId -> seedLabel(mismatchedPanoId, Some((2048, PanoH)), panoX = 512, panoY = 300),
      unrecordedPanoId -> seedLabel(unrecordedPanoId, None, panoX = 512, panoY = 300),
      excludedPanoId   -> seedLabel(excludedPanoId, Some((PanoW, PanoH)), panoX = 512, panoY = 300, excluded = true),
      outOfFramePanoId -> seedLabel(outOfFramePanoId, Some((PanoW, PanoH)), panoX = 512, panoY = PanoH + 88),
      polePanoId       -> seedLabel(polePanoId, Some((PanoW, PanoH)), panoX = 512, panoY = PanoH - 12),
      obstaclePanoId   -> seedLabel(
        obstaclePanoId,
        Some((PanoW, PanoH)),
        panoX = 512,
        panoY = 300,
        labelType = "Obstacle"
      ),
      preexistingPanoId  -> seedLabel(preexistingPanoId, Some((PanoW, PanoH)), panoX = 512, panoY = 300),
      narrowPanoId       -> seedLabel(narrowPanoId, Some((NarrowW, NarrowH)), panoX = 128, panoY = 70),
      snapshotPanoId     -> seedLabel(snapshotPanoId, Some((PanoW, PanoH)), panoX = 512, panoY = 300),
      windowPanoId       -> seedLabel(windowPanoId, Some((PanoW, PanoH)), panoX = 512, panoY = 300),
      ambiguousOldPanoId -> seedLabel(
        ambiguousOldPanoId,
        Some((WideW, WideH)),
        panoX = WideW / 2,
        panoY = WideY,
        createdDaysAgo = 3
      ),
      ambiguousNewPanoId -> seedLabel(ambiguousNewPanoId, Some((WideW, WideH)), panoX = WideW / 2, panoY = WideY),
      ambiguousAiPanoId  -> seedLabel(
        ambiguousAiPanoId,
        Some((WideW, WideH)),
        panoX = WideW / 2,
        panoY = WideY,
        ai = true
      ),
      unresolvedPanoId -> seedLabel(unresolvedPanoId, None, panoX = 512, panoY = 300, ai = true),
      // The size says snapshot and the authorship says it cannot be one, so nothing here may decide.
      snapshotAiPanoId -> seedLabel(snapshotAiPanoId, Some((PanoW, PanoH)), panoX = 512, panoY = 300, ai = true),
      // Size and authorship both point at a pano window, but pano_y is off the image, so no window contains it.
      offFrameCropPanoId -> seedLabel(
        offFrameCropPanoId,
        Some((WideW, WideH)),
        panoX = WideW / 2,
        panoY = WideH + 100,
        ai = true
      )
    )
    // The browser got there first for this label; and two downscaled copies nothing asks for any more.
    val preexisting = cropFile(preexistingPanoId)
    val _           = preexisting.getParentFile.mkdirs()
    val _           = Files.write(preexisting.toPath, preexistingCropBytes)
    val _           = plantDownscaled(narrowPanoId)
    val _           = plantDownscaled(orphanPanoId)
    // Crops from before label_crop existed, for the reconcile pass to classify.
    val _         = plantCrop(snapshotPanoId, CropService.ExploreFrameCropWidth, CropService.ExploreFrameCropHeight)
    val windowBox = boxFor(512, 300, PanoW, PanoH)
    val _         = plantCrop(windowPanoId, windowBox.width, windowBox.height)
    val _         = plantSharePreview(windowPanoId)
    Seq(ambiguousOldPanoId, ambiguousNewPanoId, ambiguousAiPanoId, unresolvedPanoId, snapshotAiPanoId,
      offFrameCropPanoId).foreach { panoId =>
      val _ = plantCrop(panoId, CropService.ExploreFrameCropWidth, CropService.ExploreFrameCropHeight)
    }

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
          sqlu"""DELETE FROM label_crop
                 WHERE label_id IN (SELECT label_id FROM label WHERE pano_id LIKE $prefixPattern)""",
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
              sqlu"DELETE FROM sidewalk_login.user_role WHERE user_id = ${s.userId}",
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

      // Backed, unrecorded, excluded, pole, obstacle and narrow are cut; unbacked, mismatched, out-of-frame and
      // preexisting are not, each for its own reason below.
      firstRun.cropsWritten mustBe 6
      firstRun.errors mustBe 0
      val crop = cropFile(backedPanoId)
      crop.exists() mustBe true
      // Exactly the window the geometry asks for at (512, 300) on a 1024x512 pano, which is far under the storage cap.
      val expected = boxFor(512, 300, PanoW, PanoH)
      val image    = ImageIO.read(crop)
      (image.getWidth, image.getHeight) mustBe (expected.width, expected.height)
      hasBackup(backedPanoId) mustBe Some(true)
    }

    "count the run's shifted crops off the geometry's own verdict" in {
      // The interior labels sit near the horizon and aren't shifted. The one 12 px above the bottom pole is: below
      // the horizon the rule reads "near field" and asks for its widest window, whose half-height is far more than
      // 12 px, so the window slides up to stay inside the image. (Near the top pole the same rule reads "far field"
      // and asks for the 8-degree floor, which fits without a shift -- so that is not the case to seed.)
      boxFor(512, 300, PanoW, PanoH).shifted mustBe false
      boxFor(128, 70, NarrowW, NarrowH).shifted mustBe false
      val pole = boxFor(512, PanoH - 12, PanoW, PanoH)
      pole.shifted mustBe true
      pole.top mustBe PanoH - pole.height
      firstRun.shiftedVertically mustBe 1
      cropFile(polePanoId).exists() mustBe true
    }

    "skip, and count, a label whose pano_y is outside the image, without writing or erroring" in {
      // The poles are not adjacent: a y past the bottom would clamp to the pole and cut clean imagery of a place the
      // label isn't in, so the label is refused up front rather than mis-cropped.
      firstRun.outOfFrame mustBe 1
      cropFile(outOfFramePanoId).exists() mustBe false
      // Its pano was still opened, so the run learnt it is backed up and downscaled it like any other.
      hasBackup(outOfFramePanoId) mustBe Some(true)
      cropService.downscaledImageFile(outOfFramePanoId).exists() mustBe true
    }

    "file each crop under its own label type" in {
      val s = seeded(obstaclePanoId)
      s.labelType mustBe "Obstacle"
      cropFile(obstaclePanoId).getParentFile.getName mustBe "Obstacle"
      cropFile(obstaclePanoId).exists() mustBe true
      panoDataService.cropFile(s.labelId, "CurbRamp").exists() mustBe false
    }

    "leave a crop that already exists exactly as it found it" in {
      // The browser's canvas snapshot is what the labeler saw; the job only fills gaps, never replaces.
      beforeRun(preexistingPanoId)._1 mustBe true
      Files.readAllBytes(cropFile(preexistingPanoId).toPath) mustBe preexistingCropBytes
      // Nothing gave the job a reason to open this pano, so it made no claim about its backup either.
      hasBackup(preexistingPanoId) mustBe None
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

    "cut a crop for an excluded user's label like anyone else's" in {
      // They are what an admin looks at to judge the exclusion, and what a study of poor labeling is made of.
      cropFile(excludedPanoId).exists() mustBe true
    }

    "skip, and count, a label whose pano row claims another size than the stored image" in {
      // Its positions are in a 2048-wide frame; cutting them from a 1024-wide image would mis-centre the crop.
      firstRun.dimsMismatch mustBe 1
      cropFile(mismatchedPanoId).exists() mustBe false
    }

    "downscale every stored pano wider than the viewer's cap, and none that isn't" in {
      // Every opened 1024-wide pano is over the 512 cap, whether or not its label was cut; the 256-wide one is not.
      firstRun.downscaledWritten mustBe 7
      val downscaled = cropService.downscaledImageFile(backedPanoId)
      downscaled.exists() mustBe true
      val image = ImageIO.read(downscaled)
      (image.getWidth, image.getHeight) mustBe (DownscaledMaxWidth, DownscaledMaxWidth / 2)
      cropService.downscaledImageFile(mismatchedPanoId).exists() mustBe true
      cropFile(narrowPanoId).exists() mustBe true
      cropService.downscaledImageFile(narrowPanoId).exists() mustBe false
    }

    "delete the downscaled copies of panos that no longer need one" in {
      // Standing in for a raised cap: the narrow pano's copy was planted before the run, as if written under a lower
      // one, and would otherwise be served in place of the native file forever. The orphan has no pano behind it at
      // all. Neither pano is one the run had reason to revisit for a crop.
      firstRun.downscaledDeleted mustBe 2
      cropService.downscaledImageFile(narrowPanoId).exists() mustBe false
      cropService.downscaledImageFile(orphanPanoId).exists() mustBe false
    }

    "record where the label is in every crop it cuts, off the geometry's own registration (#2660)" in {
      val interior = labelCrop(backedPanoId).value
      interior.source mustBe CropSource.PanoWindow
      interior.cropRuleVersion mustBe Some(CropSizingRule.Version)
      // An interior window is centred on the label, to within the rounding of its integer edges.
      interior.markerX mustBe 0.5 +- 0.01
      interior.markerY mustBe 0.5 +- 0.01
      val image = ImageIO.read(cropFile(backedPanoId))
      (interior.width, interior.height) mustBe ((image.getWidth, image.getHeight))

      // The window that slid up off the bottom pole has its label 12 px above its bottom edge, not at its centre.
      val pole    = labelCrop(polePanoId).value
      val poleBox = boxFor(512, PanoH - 12, PanoW, PanoH)
      pole.markerY mustBe (1.0 - 12.0 / poleBox.height) +- 1e-9
      pole.markerX mustBe 0.5 +- 0.01

      // Nothing was cut for these, so nothing was recorded.
      labelCrop(unbackedPanoId) mustBe None
      labelCrop(outOfFramePanoId) mustBe None
      labelCrop(mismatchedPanoId) mustBe None
    }

    "tell a browser snapshot from a job window by size, where the size can tell" in {
      // A 1440x960 file where the job's window would be far smaller: the browser's snapshot, label at its canvas
      // fraction (the seed clicks the canvas centre).
      val snapshot = labelCrop(snapshotPanoId).value
      snapshot.source mustBe CropSource.ExploreFrame
      snapshot.cropRuleVersion mustBe None
      (snapshot.markerX, snapshot.markerY) mustBe ((0.5, 0.5))
      (snapshot.width, snapshot.height) mustBe ((1440, 960))

      // A file of exactly the job's window size for this label: the job's window, label per the geometry.
      val window = labelCrop(windowPanoId).value
      window.source mustBe CropSource.PanoWindow
      window.cropRuleVersion mustBe Some(CropSizingRule.Version)
      window.markerX mustBe 0.5 +- 0.01
      window.markerY mustBe 0.5 +- 0.01
    }

    "drop the share preview of a crop it finds to be a job window, since it was composited at the canvas fraction" in {
      shareImageCache.fileFor(seeded(windowPanoId).labelId).exists() mustBe false
      // A snapshot's preview was right all along; nothing touches it (there was none to touch, and none appears).
      shareImageCache.fileFor(seeded(snapshotPanoId).labelId).exists() mustBe false
    }

    "fall back to the label's age and authorship where both writers would have stored the same size" in {
      // On the wide pano the job's window is capped at 1440x960 too, the same as a snapshot.
      CropService.storedSize(boxFor(WideW / 2, WideY, WideW, WideH)) mustBe ((1440, 960))

      // A crop written three days after the label was placed cannot be its session's upload.
      labelCrop(ambiguousOldPanoId).value.source mustBe CropSource.PanoWindow
      // One written within the session, by a person, is.
      labelCrop(ambiguousNewPanoId).value.source mustBe CropSource.ExploreFrame
      // An AI label never had a browser to upload one, however fresh the file.
      labelCrop(ambiguousAiPanoId).value.source mustBe CropSource.PanoWindow
      // The window's marker comes from the geometry, not from the canvas click.
      val (_, (fx, fy)) = CropService.windowFor(WideW / 2, WideY, WideW, WideH)
      labelCrop(ambiguousOldPanoId).value.markerX mustBe fx +- 1e-9
      labelCrop(ambiguousOldPanoId).value.markerY mustBe fy +- 1e-9
    }

    "leave a crop it cannot classify unrecorded, and say so, rather than guess" in {
      // The AI label's pano records no frame and is not in the store, so the window it would have been cut with
      // cannot be recomputed; and the tiny pre-existing file is a size neither writer produces.
      labelCrop(unresolvedPanoId) mustBe None
      labelCrop(preexistingPanoId) mustBe None
      firstRun.provenanceExplore mustBe 2
      firstRun.provenanceWindow mustBe 3
    }

    "refuse a snapshot-sized crop whose other signals disagree, rather than write the canvas fraction" in {
      // The snapshot case with an AI author. The window is recomputed from pano_data as it stands now, so a size
      // disagreement is not proof of a snapshot -- and the row a wrong guess writes stops the pass looking again.
      labelCrop(snapshotPanoId).value.source mustBe CropSource.ExploreFrame // The human, in-session control.
      labelCrop(snapshotAiPanoId) mustBe None
    }

    "refuse a crop whose pano_y is off the image, which no window can register a marker in" in {
      // The window `computeCropBox` clamps out does not contain a label below the pano, so its position falls
      // outside the image -- which label_crop's CHECK rejects, failing the whole batch that row rides in.
      labelCrop(offFrameCropPanoId) mustBe None
      val box     = boxFor(WideW / 2, WideH + 100, WideW, WideH)
      val (_, fy) = CropGeometry.labelFractionInCrop((WideW / 2).toDouble, (WideH + 100).toDouble, box, WideW)
      fy must be > 1.0 // What would have been written, and rejected, without the guard.
    }

    "count every crop it refused" in {
      firstRun.provenanceUnresolved mustBe 4
    }

    "do nothing on a second run" in {
      val crop       = cropFile(backedPanoId)
      val downscaled = cropService.downscaledImageFile(backedPanoId)
      val before     = (crop.lastModified(), crop.length(), downscaled.lastModified(), downscaled.length())
      val rowBefore  = labelCrop(backedPanoId)

      val result = generate()

      result.cropsWritten mustBe 0
      result.downscaledWritten mustBe 0
      result.downscaledDeleted mustBe 0
      result.provenanceExplore mustBe 0
      result.provenanceWindow mustBe 0
      // Still unresolved, still counted: the run keeps saying so until something can classify them.
      result.provenanceUnresolved mustBe 4
      result.errors mustBe 0
      (crop.lastModified(), crop.length(), downscaled.lastModified(), downscaled.length()) mustBe before
      labelCrop(backedPanoId) mustBe rowBefore
    }

    "run one at a time, refusing a second call while the first is in flight" in {
      val first = cropService.generateMissingCrops()
      try {
        // The guard is taken synchronously, before any of the run's work is scheduled, so this is not a race.
        cropService.isRunning mustBe true
        val second = Try(Await.result(cropService.generateMissingCrops(), 10.seconds))
        second mustBe a[Failure[_]]
        second.failed.get mustBe an[IllegalStateException]
      } finally {
        val _ = Await.result(first, 5.minutes)
      }
      cropService.isRunning mustBe false
    }

    "recut a downscaled copy left at a width the configuration no longer asks for" in {
      // Standing in for a `pano.downscaled.max-width` change, which the previous case shows a presence test can't see.
      val downscaled = cropService.downscaledImageFile(backedPanoId)
      val stale      = new BufferedImage(DownscaledMaxWidth / 2, DownscaledMaxWidth / 4, BufferedImage.TYPE_INT_RGB)
      ImageUtils.writeJpeg(stale, downscaled, CropService.DownscaledJpegQuality)

      val result = generate()

      result.downscaledWritten mustBe 1
      ImageIO.read(downscaled).getWidth mustBe DownscaledMaxWidth
    }
  }

  "CropService.recordExploreFrameCrop" should {
    "record the browser's snapshot with the label at its canvas fraction" in {
      // The unbacked label has no crop and no row; this is what POST /saveImage calls once its file is written.
      val labelId = seeded(unbackedPanoId).labelId
      labelCrop(unbackedPanoId) mustBe None

      Await.result(cropService.recordExploreFrameCrop(labelId, 1440, 960), 30.seconds)

      val row = labelCrop(unbackedPanoId).value
      row.source mustBe CropSource.ExploreFrame
      (row.markerX, row.markerY) mustBe ((0.5, 0.5))
      (row.width, row.height) mustBe ((1440, 960))
      row.cropRuleVersion mustBe None
      Await.result(cropService.cropMarker(labelId), 30.seconds).map(m => (m.x, m.y)) mustBe Some((0.5, 0.5))
      Await.result(cropService.cropMarkers(Seq(labelId, -1)), 30.seconds).keySet mustBe Set(labelId)
    }

    "skip a label with no label_point row yet, leaving it to the reconcile pass" in {
      Await.result(cropService.recordExploreFrameCrop(-2660, 1440, 960), 30.seconds)
      Await.result(cropService.cropMarker(-2660), 30.seconds) mustBe None
    }
  }

  "PanoDataTable.markHasBackup" should {
    "take a first backfill's worth of ids in one call, flagging the rows among them and no others" in {
      // A large city's first run finds tens of thousands of panos in the store and reports them all at once; the
      // update is chunked so no single statement carries them all, and this checks the chunks add up to one answer.
      val panoId = s"${prefix}chunk"
      runDb(sqlu"INSERT INTO pano_data (pano_id, capture_date, source) VALUES ($panoId, '2024-05', 'mapillary')")
      hasBackup(panoId) mustBe None

      val ids     = (1 to 70000).map(i => s"${prefix}chunk-none-$i") :+ panoId
      val updated = runDb(panoDataTable.markHasBackup(ids))

      updated mustBe 1
      hasBackup(panoId) mustBe Some(true)
      // Already flagged, so a second pass finds nothing to do.
      runDb(panoDataTable.markHasBackup(Seq(panoId))) mustBe 0
      runDb(panoDataTable.markHasBackup(Seq.empty)) mustBe 0
    }
  }

  "GET /backupImage/:panoId" should {
    "serve the downscaled copy when there is one, and the native file otherwise" in {
      val url        = signingService.signedUrl(s"/backupImage/$backedPanoId")
      val downscaled = cropService.downscaledImageFile(backedPanoId)
      downscaled.exists() mustBe true

      val withDownscaled = route(app, FakeRequest(GET, url)).get
      status(withDownscaled) mustBe OK
      contentType(withDownscaled) mustBe Some("image/jpeg")
      contentAsBytes(withDownscaled).length.toLong mustBe downscaled.length()

      // Moved aside rather than deleted, and put back, so this case leaves the store as it found it.
      val moved = new File(s"${downscaled.getPath}.moved")
      val _     = Files.move(downscaled.toPath, moved.toPath)
      try {
        val native = route(app, FakeRequest(GET, url)).get
        status(native) mustBe OK
        contentType(native) mustBe Some("image/png")
        contentAsBytes(native).length.toLong mustBe syntheticPano.length()
      } finally {
        val _ = Files.move(moved.toPath, downscaled.toPath)
      }
    }
  }
}
