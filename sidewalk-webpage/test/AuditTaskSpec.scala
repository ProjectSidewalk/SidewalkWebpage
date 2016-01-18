package test

import java.sql.Timestamp
import java.util.{UUID, Calendar, Date}

import models.audit._
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
class AuditTaskSpec extends Specification {
  "DB" should {
    "work as expected" in new WithApplication {
      val auditTasks = TableQuery[AuditTaskTable]

      DB.withTransaction { implicit s: Session =>
        val calendar: Calendar = Calendar.getInstance
        val now: Date = calendar.getTime
        val currentTimestamp: Timestamp = new Timestamp(now.getTime)
        val task = AuditTask(-2, Some(-2), "11c961e3-7181-49e6-94da-5dec3687536c", 1, currentTimestamp, currentTimestamp)

        auditTasks.insert(task)
        auditTasks.list

//        auditTasks.list
//
//        inserted.length shouldEqual 1

        s.rollback
      }
    }
  }
}
