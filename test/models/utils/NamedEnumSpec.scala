package models.utils

import models.pano.PanoSource
import models.user.{MeasurementSystem, Role}
import models.utils.MyPostgresProfile.api.given
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsError, JsString, JsSuccess}
import util.{RolledBackDb, SidewalkSpec}

/** Pins what the shared enum traits promise: how a value prints, reads from JSON, and binds in raw SQL. */
class NamedEnumSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  "a named enum" should {
    "print as its name, which is not always the Scala case's" in {
      s"${Role.Ai} ${PanoSource.Gsv}" mustBe "AI gsv"
    }

    "read a name from JSON and refuse anything else" in {
      JsString("AI").validate[Role] mustBe JsSuccess(Role.Ai)
      JsString("Ai").validate[Role] mustBe a[JsError]
    }
  }

  "PanoSource" should {
    "refuse a server-owned source from a client, while reading it back from the database" in {
      JsString("tutorial").validate[PanoSource] mustBe a[JsError]
      JsString("tutorial").validate[PanoSource](using PanoSource.storedReads) mustBe JsSuccess(PanoSource.Tutorial)
    }
  }

  "raw SQL" should {
    "take a value with no cast, even where nothing else says what type it is" in {
      run(sql"SELECT ${PanoSource.Mapillary}::text".as[String]).head mustBe "mapillary"
      run(sql"SELECT ${Role.Ai} = 'AI'".as[Boolean]).head mustBe true
    }

    "take a missing value as a typed NULL" in {
      val none: Option[MeasurementSystem] = None
      run(sql"SELECT $none IS NULL".as[Boolean]).head mustBe true
      run(sql"SELECT COALESCE($none, ${MeasurementSystem.Metric})::text".as[String]).head mustBe "metric"
    }
  }
}
