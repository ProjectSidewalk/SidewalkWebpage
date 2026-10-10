package service

import com.typesafe.config.ConfigValueFactory
import models.label.LabelTable
import models.pano.{PanoData, PanoDataTable, PanoHistoryTable, PanoImageryChangeTable, PanoSource}
import models.street.StreetEdgeTable
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api.*
import models.validation.ValidationLabelFilter
import models.validation.ValidationQueuePolicy.ValidationQueue
import org.apache.pekko.stream.Materializer
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.cache.AsyncCacheApi
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsNull, JsValue, Json}
import play.api.libs.ws.WSClient
import play.api.mvc.Results
import play.api.routing.sird.{GET as SirdGet, UrlContext}
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import play.api.{Application, Configuration, Environment}
import play.core.server.Server
import util.SidewalkSpec

import java.nio.file.{Files, Path}
import java.util.UUID
import scala.concurrent.duration.*
import scala.concurrent.{Await, ExecutionContext, Future}

/**
 * The #5725 contract end to end: a pano recorded without a camera pitch still has its backup image served and its
 * labels in the Validate pool, and the nightly imagery sweep fills the pitch in from Mapillary's `computed_rotation`
 * without ever overwriting a real value.
 *
 * The app's pano directory is a temp dir and the service's Graph API a local server. The route and the service run
 * on their own DB connections, so the staging writes are committed and the row restored, not rolled back.
 */
class BackupWithoutPitchSpec extends SidewalkSpec with GuiceOneAppPerSuite with BeforeAndAfterAll {

  private val panosDir: Path = Files.createTempDirectory("backup-without-pitch-spec")

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .configure("pano.images.directory" -> panosDir.toString)
      .disable[modules.ActorModule]
      .build()

  override def afterAll(): Unit = {
    super.afterAll()
    Files.walk(panosDir).sorted(java.util.Comparator.reverseOrder()).forEach(p => Files.deleteIfExists(p): Unit)
  }

  given mat: Materializer = app.materializer

  private lazy val dbConfig      = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private lazy val panoDataTable = app.injector.instanceOf[PanoDataTable]
  private lazy val labelTable    = app.injector.instanceOf[LabelTable]
  private lazy val baseConfig    = app.injector.instanceOf[Configuration]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)
  private def await[T](f: Future[T]): T  = Await.result(f, 60.seconds)

  /** Mapillary's `computed_rotation` for Richmond pano 2163793620710887, whose pose is (2.2318, -6.355). */
  private val richmondRotation: JsValue = Json.arr(1.3857263583832, 0.71804330335161, -0.58250746512038)

  /** A live, labelled pano, so the Validate pool has something to lose when the backup rule refuses it. */
  private lazy val panoId: String = run(
    sql"""SELECT pano_data.pano_id FROM pano_data
          JOIN label ON label.pano_id = pano_data.pano_id
          WHERE NOT pano_data.expired AND NOT label.deleted AND NOT label.tutorial
          GROUP BY pano_data.pano_id ORDER BY count(*) DESC, pano_data.pano_id LIMIT 1""".as[String]
  ).headOption.getOrElse(cancel("No live pano with labels in the connected schema."))

  private def orientation: (Option[Double], Option[Double]) = run(
    sql"SELECT camera_pitch, camera_roll FROM pano_data WHERE pano_id = $panoId"
      .as[(Option[Double], Option[Double])]
      .head
  )

  /** Runs `body` with the pano staged as the AI pipeline leaves a Mapillary one; the row is restored afterwards. */
  private def withStagedPano[T](body: PanoData => T): T = {
    val before  = run(panoDataTable.getPano(panoId)).get
    val cityDir = panosDir.resolve(baseConfig.get[String]("city-id")).resolve(panoId.take(2))
    Files.createDirectories(cityDir)
    Files.write(cityDir.resolve(s"$panoId.jpg"), Array[Byte](0))
    try {
      run(sqlu"""UPDATE pano_data
                 SET width = 8192, height = 4096, lat = 47.6, lng = -122.3, camera_heading = 180.5,
                     camera_pitch = NULL, camera_roll = NULL, has_backup = TRUE
                 WHERE pano_id = $panoId""")
      body(before)
    } finally {
      run(sqlu"""UPDATE pano_data
                 SET width = ${before.width}, height = ${before.height}, lat = ${before.lat}, lng = ${before.lng},
                     camera_heading = ${before.cameraHeading}, camera_pitch = ${before.cameraPitch},
                     camera_roll = ${before.cameraRoll}, expired = ${before.expired}, has_backup = ${before.hasBackup},
                     last_checked = ${before.lastChecked}, last_viewed = ${before.lastViewed}
                 WHERE pano_id = $panoId""")
      Files.deleteIfExists(cityDir.resolve(s"$panoId.jpg")): Unit
    }
  }

  /** The real service, with its Graph API a local server that answers every image lookup with `rotation`. */
  private def withGraph[T](rotation: JsValue)(body: PanoDataService => T): T = {
    Server.withRouterFromComponents() { components =>
      { case SirdGet(p"/$id") =>
        components.defaultActionBuilder { _ => Results.Ok(Json.obj("id" -> id, "computed_rotation" -> rotation)) }
      }
    } { port =>
      val config = Configuration(
        baseConfig.underlying
          .withValue("mapillary-graph-url", ConfigValueFactory.fromAnyRef(s"http://localhost:${port.value}"))
          .withValue("mapillary-access-token", ConfigValueFactory.fromAnyRef("spec-token"))
      )
      val service = PanoDataServiceImpl(
        app.injector.instanceOf[DatabaseConfigProvider],
        config,
        app.injector.instanceOf[Environment],
        app.injector.instanceOf[AsyncCacheApi],
        app.injector.instanceOf[WSClient],
        panoDataTable,
        app.injector.instanceOf[PanoHistoryTable],
        app.injector.instanceOf[PanoImageryChangeTable],
        app.injector.instanceOf[StreetEdgeTable],
        app.injector.instanceOf[ImageSigningService]
      )(using app.injector.instanceOf[ExecutionContext], mat)
      body(service)
    }
  }

  private def metadata: Future[play.api.mvc.Result] =
    route(app, FakeRequest(GET, s"/backupImage/$panoId/metadata").withHeaders(REFERER -> "http://localhost:9000/")).get

  /** Labels Validate could serve a user who has placed and validated nothing, on the pano's imagery source. */
  private def servable(source: PanoSource): Int = run(
    labelTable.getAvailableValidationsLabelsByType(
      UUID.randomUUID.toString, source, unvalidatedOnly = false, ValidationQueue.crowdCascade, None,
      ValidationLabelFilter()
    )
  ).map(_.validationsAvailable).sum

  "/backupImage/:panoId/metadata" should {
    "serve the backup of a pano with no camera pitch, and refuse one whose heading is NaN" in withStagedPano { _ =>
      run(sqlu"UPDATE pano_data SET expired = TRUE WHERE pano_id = $panoId")
      val served = metadata
      status(served) mustBe OK
      (contentAsJson(served) \ "camera_pitch").get mustBe JsNull
      (contentAsJson(served) \ "width").as[Int] mustBe 8192

      run(sqlu"UPDATE pano_data SET camera_heading = 'NaN' WHERE pano_id = $panoId")
      status(metadata) mustBe NOT_FOUND
    }
  }

  "the Validate pool" should {
    "keep a pano's labels when its backup has no camera pitch, as if the imagery were live" in withStagedPano {
      before =>
        val live = servable(before.source)
        run(sqlu"UPDATE pano_data SET expired = TRUE WHERE pano_id = $panoId")
        val backupWithoutPitch = servable(before.source)
        run(sqlu"UPDATE pano_data SET camera_heading = 'NaN' WHERE pano_id = $panoId")
        val backupWithNaNHeading = servable(before.source)

        backupWithoutPitch mustBe live
        backupWithNaNHeading must be < live
    }
  }

  "the imagery check" should {
    "fill a missing pitch from computed_rotation, and never overwrite a real one" in withStagedPano { _ =>
      withGraph(richmondRotation)(service => await(service.panoExists(panoId, PanoSource.Mapillary)) mustBe Some(true))
      val (pitch, roll) = orientation
      pitch.get mustBe (2.231776541825151 +- 1e-9)
      roll.get mustBe (-6.354952531976069 +- 1e-9)

      // A level camera now: the stored pose is a real reading of the same image, so it stands.
      withGraph(Json.arr(math.Pi / 2, 0.0, 0.0))(service => await(service.panoExists(panoId, PanoSource.Mapillary)))
      orientation mustBe (pitch, roll)
    }

    "leave the pitch missing for an image with no rotation or a failed reconstruction" in withStagedPano { _ =>
      withGraph(JsNull)(service => await(service.panoExists(panoId, PanoSource.Mapillary)) mustBe Some(true))
      orientation mustBe (None, None)
      // Upside down: past the tilt cap the auto-labeler and this fill share.
      withGraph(Json.arr(math.Pi, 0.0, 0.0))(service => await(service.panoExists(panoId, PanoSource.Mapillary)))
      orientation mustBe (None, None)
    }
  }
}
