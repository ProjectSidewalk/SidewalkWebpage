package models.mission

import models.utils.MyPostgresDriver.simple._
import models.region._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class Mission(missionId: Int, regionId: Option[Int], mission: String, level: Double, deleted: Boolean)

class MissionTable(tag: Tag) extends Table[Mission](tag, Some("sidewalk"), "mission") {
  def missionId = column[Int]("mission_id", O.PrimaryKey, O.AutoInc)
  def regionId = column[Option[Int]]("region_id", O.Nullable)
  def mission = column[String]("mission", O.NotNull)
  def level = column[Double]("level", O.NotNull)
  def deleted = column[Boolean]("deleted", O.NotNull)

  def * = (missionId, regionId, mission, level, deleted) <> ((Mission.apply _).tupled, Mission.unapply)

  def region: ForeignKeyQuery[RegionTable, Region] =
    foreignKey("mission_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)
}

object MissionTable {
  val db = play.api.db.slick.DB
  val missions = TableQuery[MissionTable]

  /**
    * Returns all the missions
    * @return A list of SidewalkEdge objects.
    */
  def all: List[Mission] = db.withSession { implicit session =>
    missions.filter(_.deleted === false).sortBy(_.missionId).list
  }

  def save(mission: Mission): Int = db.withTransaction { implicit session =>
    val missionId: Int =
      (missions returning missions.map(_.missionId)) += mission
    missionId
  }
}
