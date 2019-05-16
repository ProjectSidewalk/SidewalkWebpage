package models.mission

import models.utils.MyPostgresDriver.simple._
import org.specs2.mutable._
import play.api.db.slick.DB
import play.api.test._


//class MissionUserSpec extends Specification {
//  "MissionUserTable" should {
//    "be able to insert" in new WithApplication {
//      val missionUsers = TableQuery[MissionUserTable]
//
//      DB.withTransaction { implicit s: Session =>
//        val originalLength = missionUsers.length.run
//        val missionUser = MissionUser(-1, -1, "Test")
//        missionUsers.insert(missionUser)
//        val length = missionUsers.length.run
//        (length - originalLength) shouldEqual 1
//
//        s.rollback
//      }
//    }
//
//    "be able to check presence of duplicate record" in new WithApplication() {
//      val missionUsers = TableQuery[MissionUserTable]
//
//      DB.withTransaction { implicit s: Session =>
////        val originalLength = missionUsers.length.run
////
////        // I have not inserted anything yet, so matchedSize should be zero
////        val size1: Int = missionUsers.filter(m => m.missionId === -1 && m.userId.toString == "Test").length.run
////        size1 shouldEqual 0
////        MissionUserTable.exists(-1, "Test") shouldEqual false
////
////        // Now I inserted a record, the matched length shoudld be 1
////        val missionUser = MissionUser(-1, -1, "Test")
////        MissionUserTable.save(missionUser)
////
////        val size2: Int = missionUsers.list.count(m => m.missionId == -1 && m.userId.toString == "Test")
////        size2 shouldEqual 1
////        MissionUserTable.exists(-1, "Test") shouldEqual false
//
//        s.rollback
//      }
//    }
//  }
//}