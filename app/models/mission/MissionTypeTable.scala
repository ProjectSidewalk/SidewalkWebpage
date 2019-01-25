package models.mission

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class MissionType(missionTypeId: Int, missionType: String)

class MissionTypeTable(tag: slick.lifted.Tag) extends Table[MissionType](tag, Some("sidewalk"), "mission_type") {
  def missionTypeId: Rep[Int] = column[Int]("mission_type_id", O.PrimaryKey, O.AutoInc)
  def missionType: Rep[String] = column[String]("mission_type")

  def * = (missionTypeId, missionType) <> ((MissionType.apply _).tupled, MissionType.unapply)
}

/**
 * Data access object for the mission_type table
 */
object MissionTypeTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val missionTypes = TableQuery[MissionTypeTable]

  val onboardingTypes: List[String] = List("auditOnboarding", "validationOnboarding")
  val onboardingTypeIds: Future[List[Int]] = db.run(
    missionTypes.filter(_.missionType inSet onboardingTypes).map(_.missionTypeId).to[List].result)

  /**
   * Gets the mission type id from the mission type name
   *
   * @param missionType
   * @return
   */
  def missionTypeToId(missionType: String): Future[Int] = db.run(
    missionTypes.filter(_.missionType === missionType).map(_.missionTypeId).result.head)

  /**
   * Gets the mission type name from the mission type id
   *
   * @param missionTypeId
   * @return
   */
  def missionTypeIdToMissionType(missionTypeId: Int): Future[String] = db.run(
    missionTypes.filter(_.missionTypeId === missionTypeId).map(_.missionType).result.head)

  /**
   * Saves a new mission type in the table
   * @param missionType
   * @return
   */
  def save(missionType: MissionType): Future[Int] = db.run(
    ((missionTypes returning missionTypes.map(_.missionTypeId)) += missionType).transactionally)
}
