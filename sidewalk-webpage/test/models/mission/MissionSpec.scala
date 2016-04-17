package models.mission

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
//        missionId: Int, regionId: Option[Int], label: String, level: Int, distance: Option[Double], coverage: Option[Double], deleted: Boolean
        val mission = Mission(-1, Some(-1), "Test Mission", 1, Some(1.0), Some(1.0), deleted=false)
        missions.insert(mission)
        val length = missions.list.size
        (length - originalLength) shouldEqual 1

        s.rollback
      }
    }
  }
}
