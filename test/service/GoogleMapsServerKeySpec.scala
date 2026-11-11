package service

import models.pano.PanoSource
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.{Application, Configuration}
import util.SidewalkSpec

/** Which Google key each Street View URL carries: the browser key needs a browser's Referer (#5647). */
class GoogleMapsServerKeySpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .configure("google-maps-api-key" -> "browser-key", "google-maps-server-key" -> "server-key")
      .disable[modules.ActorModule]
      .build()

  private val panoDataService = app.injector.instanceOf[PanoDataService]

  "PanoDataService.googleServerKey" should {
    "use the server key when it is set" in {
      val config = Configuration("google-maps-api-key" -> "browser", "google-maps-server-key" -> "server")
      PanoDataService.googleServerKey(config) mustBe Some("server")
    }

    "fall back to the browser key when the server key is unset or blank" in {
      PanoDataService.googleServerKey(Configuration("google-maps-api-key" -> "browser")) mustBe Some("browser")
      val blank = Configuration("google-maps-api-key" -> "browser", "google-maps-server-key" -> "")
      PanoDataService.googleServerKey(blank) mustBe Some("browser")
    }
  }

  "PanoDataService" should {
    "give browsers the browser key and keep the server key for URLs the server fetches" in {
      val browserUrl = panoDataService.getBrowserImageUrl("pano", PanoSource.Gsv, 0, 0, 1, 720, 480).get
      val serverUrl  = panoDataService.getServerImageUrl("pano", PanoSource.Gsv, 0, 0, 1, 720, 480).get
      browserUrl must (include("key=browser-key") and not include "server-key")
      serverUrl must (include("key=server-key") and not include "browser-key")
    }
  }
}
