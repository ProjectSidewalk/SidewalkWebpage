package models.pano

import models.utils.MyPostgresProfile.api.*
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

/**
 * Pins the backup-image field rule (`PanoDataTable.hasBackupViewerFields` and its in-memory twin) and the camera
 * orientation fill the nightly sweep runs (#5725), against the connected DB. Every write is rolled back.
 */
class BackupViewerFieldsSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val panoDataTable = app.injector.instanceOf[PanoDataTable]

  private lazy val panoId: String = run(
    sql"SELECT pano_id FROM pano_data ORDER BY pano_id LIMIT 1".as[String]
  ).headOption.getOrElse(cancel("No pano in the connected schema."))

  /** Gives the pano every rendering field, so each test below can knock one out. */
  private def complete: DBIO[Int] =
    sqlu"""UPDATE pano_data SET width = 8192, height = 4096, lat = 47.6, lng = -122.3, camera_heading = 180.5,
                                camera_pitch = NULL, camera_roll = NULL
           WHERE pano_id = $panoId"""

  /** The Slick predicate and the case-class method, which must agree. */
  private def viewable: DBIO[(Boolean, Boolean)] =
    for {
      viaQuery <- panoDataTable.panoDataRecords
        .filter(_.panoId === panoId)
        .map(pd => PanoDataTable.hasBackupViewerFields(pd))
        .result
        .head
      row <- panoDataTable.getPano(panoId)
    } yield (viaQuery, row.get.hasBackupViewerFields)

  private def orientation: DBIO[(Option[Double], Option[Double])] =
    sql"SELECT camera_pitch, camera_roll FROM pano_data WHERE pano_id = $panoId"
      .as[(Option[Double], Option[Double])]
      .head

  "hasBackupViewerFields" should {
    "not need a camera pitch" in {
      runRolledBack(complete.flatMap(_ => viewable)) mustBe (true, true)
    }

    "need a heading that is a number, in both forms" in {
      val (nan, missing) = runRolledBack(for {
        _       <- complete
        _       <- sqlu"UPDATE pano_data SET camera_heading = 'NaN' WHERE pano_id = $panoId"
        nan     <- viewable
        _       <- sqlu"UPDATE pano_data SET camera_heading = NULL WHERE pano_id = $panoId"
        missing <- viewable
      } yield (nan, missing))
      nan mustBe (false, false)
      missing mustBe (false, false)
    }

    "need the dimensions and the camera position" in {
      runRolledBack(for {
        _  <- complete
        _  <- sqlu"UPDATE pano_data SET width = NULL WHERE pano_id = $panoId"
        r1 <- viewable
        _  <- complete
        _  <- sqlu"UPDATE pano_data SET lat = NULL WHERE pano_id = $panoId"
        r2 <- viewable
      } yield Seq(r1, r2)) mustBe Seq((false, false), (false, false))
    }
  }

  "fillMissingCameraOrientation" should {
    "fill a missing or NaN pitch and leave a real one alone" in {
      val (filled, kept, replacedNaN) = runRolledBack(for {
        _      <- complete
        n1     <- panoDataTable.fillMissingCameraOrientation(panoId, 2.5, -6.0)
        filled <- orientation
        n2     <- panoDataTable.fillMissingCameraOrientation(panoId, 9.0, 9.0)
        kept   <- orientation
        _      <- sqlu"UPDATE pano_data SET camera_pitch = 'NaN', camera_roll = 'NaN' WHERE pano_id = $panoId"
        n3     <- panoDataTable.fillMissingCameraOrientation(panoId, 1.0, 1.0)
        nan    <- orientation
      } yield ((n1, filled), (n2, kept), (n3, nan)))
      filled mustBe (1, (Some(2.5), Some(-6.0)))
      kept mustBe (0, (Some(2.5), Some(-6.0)))
      replacedNaN mustBe (1, (Some(1.0), Some(1.0)))
    }
  }
}
