package formats.json

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import service.LabelService

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Contract tests for the shared label-card metadata JSON: the serialized label carries its own point coordinates
 * (`lat`/`lng`) as distinct fields from the camera position (`camera_lat`/`camera_lng`), since the card's "Explore
 * the sidewalks here" link (#4637) seeds Explore with the label's coordinates, not the photographer's.
 *
 * Boots the full application against the real Slick/PostGIS DB (like the controller specs) so the metadata query is
 * exercised end to end; cancels (not fails) when the connected DB has no suitable labels.
 */
class LabelMetadataJsonSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val labelService: LabelService = app.injector.instanceOf[LabelService]

  private lazy val recentLabels = Await.result(labelService.getRecentLabelMetadata(50), 60.seconds)

  "label-card metadata JSON" should {
    "always carry lat/lng keys alongside the camera position" in {
      recentLabels.headOption match {
        case None       => cancel("No labels in the connected test DB; cannot exercise the metadata serializer.")
        case Some(meta) =>
          val json = LabelFormats.labelMetadataWithValidationToJson(meta)
          json.keys must contain allOf ("lat", "lng", "camera_lat", "camera_lng")
      }
    }

    "serialize the label's own point coordinates into lat/lng" in {
      recentLabels.find(_.location.isDefined) match {
        case None       => cancel("No labels with point coordinates in the connected test DB.")
        case Some(meta) =>
          val json = LabelFormats.labelMetadataWithValidationToJson(meta)
          (json \ "lat").asOpt[Double] mustBe meta.location.map(_.lat)
          (json \ "lng").asOpt[Double] mustBe meta.location.map(_.lng)
          (json \ "camera_lat").asOpt[Double] mustBe meta.cameraLocation.map(_.lat)
          (json \ "camera_lng").asOpt[Double] mustBe meta.cameraLocation.map(_.lng)
      }
    }
  }
}
