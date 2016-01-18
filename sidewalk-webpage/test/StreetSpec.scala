package test

import models.street._
import org.specs2.mutable._
import play.api.db.slick.DB
// import play.api.db.slick.Config.driver.simple._
import models.utils.MyPostgresDriver.simple._
import play.api.test._
import play.api.test.Helpers._
import models._

/**
  * An example from:
  * http://www.typesafe.com/activator/template/play-slick-quickstart
  */
class StreetSpec extends Specification {
  "DB" should {
    "work as expected" in new WithApplication {
      val streetEdges = TableQuery[StreetEdgeTable]

      DB.withTransaction { implicit s: Session =>

      }
    }
  }
}
