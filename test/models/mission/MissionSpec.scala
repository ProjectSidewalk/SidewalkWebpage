package models.mission

import org.junit.runner._
import models.mission.MissionTable._
import models.utils.MyPostgresDriver.simple._
import org.specs2.mutable._
import org.specs2.runner._
import play.api.db.slick.DB

import play.api.test._
import play.api.test.Helpers._


//class MissionSpec extends Specification {
////  "MissionTable" should {
////    "run" in new WithApplication(FakeApplication()) {
////      DB.withSession { implicit session =>
////        missions ++= Seq(
////          Mission(1, Some(1), "test", 1, Some(1000), Some(3000), Some(1), Some(0.5), deleted=false),
////          Mission(2, Some(1), "test", 2, Some(2000), Some(6000), Some(2), Some(1.0), deleted=false))
////      }
////
////      1 should equalTo(1)
//
//
////      DB.withTransaction { implicit s: Session =>
////        val originalLength = missions.length.run
//////        missionId: Int, regionId: Option[Int], label: String, level: Int, distance: Option[Double], coverage: Option[Double], deleted: Boolean
////        val mission = Mission(-1, Some(-1), "Test Mission", 1, Some(1.0), Some(1.0), deleted=false)
////        missions.insert(mission)
////        val length = missions.length.run
////        (length - originalLength) shouldEqual 1
////
////        s.rollback
////      }
////    }
////  }
//}
