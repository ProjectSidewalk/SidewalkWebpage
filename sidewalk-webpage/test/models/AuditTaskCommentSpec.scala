package models


import java.sql.Timestamp
import java.util.{Calendar, Date}

import models.audit._
import org.specs2.mutable._
import play.api.db.slick.DB
// import play.api.db.slick.Config.driver.simple._
import models.utils.MyPostgresDriver.simple._
import play.api.test._

class AuditTaskCommentSpec extends Specification  {
  "AuditTaskComment table" should {
    "be able to insert" in new WithApplication {
      val auditTaskComments = TableQuery[AuditTaskCommentTable]

      DB.withTransaction { implicit s: Session =>
        val calendar: Calendar = Calendar.getInstance
        val now: Date = calendar.getTime
        val currentTimestamp: Timestamp = new Timestamp(now.getTime)

        val comment: AuditTaskComment = AuditTaskComment(0, 0, "test", "0.0.0.0", Some("test"), Some(0.0), Some(0.0), Some(1), currentTimestamp, "comment")
        auditTaskComments.insert(comment)

        val filtered = auditTaskComments.list
        filtered.length shouldEqual 1

        s.rollback
      }
    }
  }
}
