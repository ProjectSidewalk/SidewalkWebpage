import org.specs2.mutable._
import org.specs2.runner._
import org.junit.runner._

import java.sql.Timestamp
import java.util.{Calendar, Date}

import play.api.test._
import play.api.test.Helpers._
import play.api.db.slick.DB

import models.utils.MyPostgresDriver.simple._
import models.audit._


@RunWith(classOf[JUnitRunner])
class ApplicationSpec extends Specification {

  "Application" should {

    "send 404 on a bad request" in new WithApplication{
      route(FakeRequest(GET, "/boum")) must beNone
    }

    "render the index page" in new WithApplication{
      val home = route(FakeRequest(GET, "/")).get

      status(home) must equalTo(OK)
      contentType(home) must beSome.which(_ == "text/html")
      contentAsString(home) must contain ("Project Sidewalk")
    }
  }
}

