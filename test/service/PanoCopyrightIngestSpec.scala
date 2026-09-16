package service

import formats.json.ExploreFormats.{AiLabelsSubmission, PanoSubmission}
import models.pano.{PanoDataTable, PanoSource}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import scala.concurrent.{Await, Future}
import scala.concurrent.duration._

/**
 * DB-backed contract test for what a submission's copyright becomes in `pano_data.copyright` (#5360).
 *
 * The column holds a Mapillary or Panoramax contributor's bare name, which `ImageryAttribution` composes the sign,
 * the provider and the licence around. The AI labeler submits the whole attribution instead, and until the service
 * unwrapped it every crop of its imagery was credited "© © name / Mapillary (CC BY-SA 4.0) · Mapillary · …". This
 * pins the guard at the one place every submission passes through, by way of the AI endpoint's service method with
 * no detections, which writes the pano and nothing else.
 *
 * Seeds its own pano rather than hunting for one in the connected DB, so it can never pass vacuously. Requires a
 * Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI); the scheduling actors
 * are disabled so no background sweep touches the row mid-test.
 */
class PanoCopyrightIngestSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val exploreService = app.injector.instanceOf[ExploreService]
  private val panoDataTable  = app.injector.instanceOf[PanoDataTable]
  private val dbConfig       = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)
  private def await[T](f: Future[T]): T  = Await.result(f, 60.seconds)

  private val panoIds = Seq("test-5360-mapillary", "test-5360-panoramax", "test-5360-gsv")

  /** A pano block as the AI labeler sends it, with the copyright it composes. */
  private def submission(panoId: String, source: PanoSource.Value, copyright: String): AiLabelsSubmission =
    AiLabelsSubmission(
      labelType = "CurbRamp",
      modelId = "test",
      modelTrainingDate = "01-01-2026",
      apiVersion = "test",
      pano = PanoSubmission(panoId = panoId, source = source, captureDate = "2025-10", width = Some(8192),
        height = Some(4096), tileWidth = None, tileHeight = None, lat = Some(37.55), lng = Some(-77.46),
        cameraHeading = Some(0d), cameraPitch = None, cameraRoll = None, links = Seq.empty, copyright = Some(copyright),
        license = None, address = None, history = Seq.empty, sourceMetadata = None),
      labels = Seq.empty
    )

  private def storedCopyright(panoId: String): Option[String] = run(panoDataTable.getPano(panoId)).value.copyright

  private def deleteSeeded(): Unit = {
    val _ = run(panoDataTable.panoDataRecords.filter(_.panoId inSet panoIds).delete)
  }

  override def beforeAll(): Unit = {
    super.beforeAll()
    deleteSeeded()
  }

  override def afterAll(): Unit = {
    deleteSeeded()
    super.afterAll()
  }

  "pano_data.copyright" should {
    "hold a Mapillary contributor's bare name when the submission wrapped it in a whole attribution" in {
      await(
        exploreService.submitAiLabelData(
          submission("test-5360-mapillary", PanoSource.Mapillary, "© GIS_ISG / Mapillary (CC BY-SA 4.0)")
        )
      )
      storedCopyright("test-5360-mapillary") mustBe Some("GIS_ISG")
    }

    "hold a Panoramax producer's bare name likewise" in {
      await(
        exploreService.submitAiLabelData(
          submission("test-5360-panoramax", PanoSource.Panoramax, "© Arretche / Panoramax (CC-BY-SA-4.0)")
        )
      )
      storedCopyright("test-5360-panoramax") mustBe Some("Arretche")
    }

    "hold a provider's own copyright string as sent" in {
      await(exploreService.submitAiLabelData(submission("test-5360-gsv", PanoSource.Gsv, "© 2025 Google")))
      storedCopyright("test-5360-gsv") mustBe Some("© 2025 Google")
    }
  }
}
