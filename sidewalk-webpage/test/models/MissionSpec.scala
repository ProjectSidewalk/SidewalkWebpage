package models

import models.mission.{MissionUser, MissionUserTable, Mission, MissionTable}
import models.utils.MyPostgresDriver.simple._
import org.specs2.mutable._
import play.api.db.slick.DB
import play.api.test._


class MissionSpec extends Specification {
  "MissionTable" should {
    "be able to insert" in new WithApplication {
      val missions = TableQuery[MissionTable]

      DB.withTransaction { implicit s: Session =>
        val originalLength = missions.list.size
        val mission = Mission(-1, Some(-1), "Test Mission", 1.0, deleted=false)
        missions.insert(mission)
        val length = missions.list.size
        (length - originalLength) shouldEqual 1

        s.rollback
      }
    }
  }

  "MissionUserTable" should {
    "be able to insert" in new WithApplication {
      val missionUsers = TableQuery[MissionUserTable]

      DB.withTransaction { implicit s: Session =>
        val originalLength = missionUsers.list.size
        val missionUser = MissionUser(-1, -1, "Test")
        missionUsers.insert(missionUser)
        val length = missionUsers.list.size
        (length - originalLength) shouldEqual 1
      }
    }
  }

}
