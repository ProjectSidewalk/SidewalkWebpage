package models.audit

import java.sql.Timestamp
import java.util.{Calendar, Date}

import models.utils.MyPostgresDriver.simple._
import org.specs2.mutable._
import play.api.db.slick.DB
import play.api.test._


class AuditTaskSpec extends Specification {
  "AuditTask table" should {
    "be able to insert" in new WithApplication {
      val auditTasks = TableQuery[AuditTaskTable]

      DB.withTransaction { implicit s: Session =>
        val calendar: Calendar = Calendar.getInstance
        val now: Date = calendar.getTime
        val currentTimestamp: Timestamp = new Timestamp(now.getTime)
        val task = AuditTask(-2, Some(-2), "c51d32f6-18cc-40c4-90c6-1a0da021e9f2", 1, currentTimestamp, Some(currentTimestamp))

        auditTasks.insert(task)

        val filtered = auditTasks.filter(_.amtAssignmentId.getOrElse(-1) === -2).list
        filtered.length shouldEqual 1

        s.rollback
      }
    }
  }

}
