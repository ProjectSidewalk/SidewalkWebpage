package models.pano

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import java.time.OffsetDateTime
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed contract test for `pano_data.license` (#5202, evolution 376).
 *
 * A Panoramax contributor picks a licence per picture, so it can't be inferred from `source` the way Mapillary's
 * can, and it is what lets `ImageryAttribution` name the licence on a crop or a self-hosted pano that Project
 * Sidewalk renders itself. It is an intrinsic property of the picture, so `upsert` treats it like `copyright`: fill
 * a NULL, never overwrite, never clear.
 *
 * Seeds its own pano rather than hunting for one in the connected DB, so it can never pass vacuously. Requires a
 * Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the scheduling actors
 * are disabled so no background sweep touches the row mid-test.
 */
class PanoLicenseSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val panoDataTable = app.injector.instanceOf[PanoDataTable]
  private val dbConfig      = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val panoId = "test-5202-license"

  /** A Panoramax picture as its viewer would record it, with whatever licence the submission carried. */
  private def pano(license: Option[String]): PanoData = PanoData(
    panoId = panoId, width = Some(8192), height = Some(4096), tileWidth = Some(512), tileHeight = Some(512),
    captureDate = "2025-04", copyright = Some("Arretche"), license = license, lat = Some(43.49), lng = Some(-1.47),
    cameraHeading = Some(0d), cameraPitch = Some(0d), cameraRoll = Some(0d), expired = false,
    lastViewed = OffsetDateTime.now, panoHistorySaved = None, lastChecked = OffsetDateTime.now,
    source = PanoSource.Panoramax, hasBackup = Some(false), address = None, sourceMetadata = None
  )

  private def storedLicense: Option[String] = run(panoDataTable.getPano(panoId)).flatMap(_.license)

  override def beforeAll(): Unit = {
    super.beforeAll()
    val _ = run(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
  }

  override def afterAll(): Unit = {
    val _ = run(sqlu"DELETE FROM pano_data WHERE pano_id = $panoId")
    super.afterAll()
  }

  "pano_data.license" should {
    "be null for a pano submitted without one" in {
      run(panoDataTable.upsert(pano(None)))
      storedLicense mustBe None
    }

    "be filled in by a later submission that carries one" in {
      run(panoDataTable.upsert(pano(Some("CC-BY-SA-4.0"))))
      storedLicense mustBe Some("CC-BY-SA-4.0")
    }

    "survive a later submission that carries none, rather than being cleared" in {
      run(panoDataTable.upsert(pano(None)))
      storedLicense mustBe Some("CC-BY-SA-4.0")
    }

    // A picture's licence is a property of the picture, so a differing value is a client bug or a stale tab, not a
    // relicensing. Keeping the first recorded value matches how `copyright` and the dimensions behave.
    "keep the recorded value when a later submission disagrees" in {
      run(panoDataTable.upsert(pano(Some("etalab-2.0"))))
      storedLicense mustBe Some("CC-BY-SA-4.0")
    }

    "reach the attribution a crop or a self-hosted pano is rendered with" in {
      val stored = run(panoDataTable.getPano(panoId)).value
      val line   = ImageryAttribution.line(stored.source, stored.copyright, stored.license).value
      line.text mustBe "© Arretche · Panoramax · CC BY-SA 4.0"
      line.licenseUrl mustBe Some("https://creativecommons.org/licenses/by-sa/4.0/")
    }
  }
}
