package models.audit

import java.sql.Timestamp
import java.util.{Calendar, Date}

import models.utils.MyPostgresDriver.simple._
import org.specs2.mutable._
import play.api.db.slick.DB
import play.api.test._

//class AuditTaskCommentSpec extends Specification  {
//  "AuditTaskCommentTable" should {
//    "be able to insert" in new WithApplication {
//      val auditTaskComments = TableQuery[AuditTaskCommentTable]
//
//      DB.withTransaction { implicit s: Session =>
//        val originalLength = auditTaskComments.length.run
//        val calendar: Calendar = Calendar.getInstance
//        val now: Date = calendar.getTime
//        val currentTimestamp: Timestamp = new Timestamp(now.getTime)
//
//        val comment: AuditTaskComment = AuditTaskComment(0, 0, "test", "0.0.0.0", Some("test"), Some(0.0), Some(0.0), Some(1), Some(0.0), Some(0.0), currentTimestamp, "comment")
//        auditTaskComments.insert(comment)
//
//        val length = auditTaskComments.length.run
//
//        (length - originalLength) shouldEqual 1
//
//        s.rollback
//      }
//    }
//  }
//}
