package models.pano

import models.utils.MyPostgresProfile.api.*
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import service.PanoDataService.LiveImageryTtlDays
import util.{RolledBackDb, SidewalkSpec}

import java.time.OffsetDateTime

/**
 * Pins `PanoDataTable.insertTutorialPanosIfMissing`, which gives a city launched from a dump the tutorial panos' rows
 * with its first tutorial label (#6036): both rows with evolution 360's values, nothing on a second call, and an
 * existing row left exactly as it was. And since the rows it writes are freshly checked, the reuse lookup must still
 * leave them unanswered: their source, not their age, is what keeps them from passing as live imagery.
 *
 * Each test runs against an empty scratch copy of pano_data: a temp table of the same name, which the session's
 * search_path finds first, so the result doesn't depend on whether the connected city already has the rows. The
 * transaction is rolled back, which drops it.
 */
class TutorialPanoRowsSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val panoDataTable = app.injector.instanceOf[PanoDataTable]

  private val scratchPanoData: DBIO[Int] = sqlu"CREATE TEMP TABLE pano_data (LIKE pano_data INCLUDING ALL)"

  private type Row = (String, Int, Int, Int, Int, String, String, Double, Double, Double, Double, String)

  private val readRows: DBIO[Seq[Row]] =
    sql"""SELECT pano_id, width, height, tile_width, tile_height, capture_date, copyright, lat, lng, camera_heading,
                 camera_pitch, source::text
          FROM pano_data ORDER BY pano_id""".as[Row]

  "PanoDataTable.insertTutorialPanosIfMissing" should {
    "write both tutorial panos' rows with evolution 360's values" in {
      val (written, rows) = runRolledBack(for {
        _       <- scratchPanoData
        written <- panoDataTable.insertTutorialPanosIfMissing
        rows    <- readRows
      } yield (written, rows))

      written must contain theSameElementsAs Seq("tutorial", "afterWalkTutorial")
      rows mustBe Seq(
        ("afterWalkTutorial", 3400, 1700, 1700, 850, "2014-05", "Imagery (c) 2010 Google", 38.94061618, -77.06768201,
          344.0, 0.0, "tutorial"),
        ("tutorial", 4096, 2048, 2048, 1024, "2014-05", "Imagery (c) 2010 Google", 38.94042608, -77.06766133, 50.3866,
          1.13769, "tutorial")
      )
    }

    "write nothing when the rows are already there" in {
      val (second, count) = runRolledBack(for {
        _      <- scratchPanoData
        _      <- panoDataTable.insertTutorialPanosIfMissing
        second <- panoDataTable.insertTutorialPanosIfMissing
        count  <- sql"SELECT count(*) FROM pano_data".as[Int].head
      } yield (second, count))

      second mustBe empty
      count mustBe 2
    }

    "leave an existing row exactly as it is and write only the missing one" in {
      val (written, before, after) = runRolledBack(for {
        _ <- scratchPanoData
        _ <- sqlu"""INSERT INTO pano_data (pano_id, width, capture_date, source, address, last_viewed, last_checked)
                    VALUES ('tutorial', 13312, '2010-01', 'tutorial', 'kept', '2020-01-01', '2020-01-02')"""
        before  <- sql"SELECT row_to_json(pano_data)::text FROM pano_data WHERE pano_id = 'tutorial'".as[String].head
        written <- panoDataTable.insertTutorialPanosIfMissing
        after   <- sql"SELECT row_to_json(pano_data)::text FROM pano_data WHERE pano_id = 'tutorial'".as[String].head
      } yield (written, before, after))

      written mustBe Seq("afterWalkTutorial")
      after mustBe before
    }

    "leave the reuse lookup with no answer for them, fresh as their last_checked is" in {
      val statuses = runRolledBack(for {
        _        <- scratchPanoData
        _        <- panoDataTable.insertTutorialPanosIfMissing
        statuses <- panoDataTable.getReusableImageryStatus(
          PanoDataTable.TutorialPanoIds,
          OffsetDateTime.now.minusDays(LiveImageryTtlDays)
        )
      } yield statuses)

      statuses mustBe empty
    }
  }
}
