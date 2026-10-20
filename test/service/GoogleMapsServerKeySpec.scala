package service

import com.typesafe.config.{ConfigFactory, ConfigResolveOptions}
import models.pano.PanoSource
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.SidewalkSpec

import scala.jdk.CollectionConverters.*

/** Which Google key each Street View URL carries: the browser key needs a browser's Referer (#5647). */
class GoogleMapsServerKeySpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .configure("google-maps-api-key" -> "browser-key", "google-maps-server-key" -> "server-key")
      .disable[modules.ActorModule]
      .build()

  private val panoDataService = app.injector.instanceOf[PanoDataService]

  /** Resolves the real application.conf against `env` alone; `noSystem` keeps the real keys out of the test. */
  private def serverKeyWith(env: Map[String, String]): String =
    ConfigFactory
      .parseResources("application.conf")
      .withOnlyPath("google-maps-server-key")
      .withFallback(ConfigFactory.parseMap(env.asJava))
      .resolve(ConfigResolveOptions.noSystem())
      .getString("google-maps-server-key")

  "google-maps-server-key" should {
    "fall back to the browser key until an environment sets its own" in {
      serverKeyWith(Map("GOOGLE_MAPS_API_KEY" -> "browser")) mustBe "browser"
      serverKeyWith(Map("GOOGLE_MAPS_API_KEY" -> "browser", "GOOGLE_MAPS_SERVER_KEY" -> "server")) mustBe "server"
    }
  }

  "PanoDataService" should {
    "give browsers the browser key and keep the server key for URLs the server fetches" in {
      val browserUrl = panoDataService.getImageUrl("pano", PanoSource.Gsv, 0, 0, 1, 720, 480).get
      val serverUrl  = panoDataService.getServerImageUrl("pano", PanoSource.Gsv, 0, 0, 1, 720, 480).get
      browserUrl must (include("key=browser-key") and not include "server-key")
      serverUrl must (include("key=server-key") and not include "browser-key")
    }
  }
}
