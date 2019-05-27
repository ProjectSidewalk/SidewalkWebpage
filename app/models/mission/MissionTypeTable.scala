package models.mission

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class MissionType(missionTypeId: Int, missionType: String)


class MissionTypeTable(tag: slick.lifted.Tag) extends Table[MissionType](tag, Some("sidewalk"), "mission_type") {
  def missionTypeId: Column[Int] = column[Int]("mission_type_id", O.PrimaryKey, O.AutoInc)
  def missionType: Column[String] = column[String]("mission_type", O.NotNull)

  def * = (missionTypeId, missionType) <> ((MissionType.apply _).tupled, MissionType.unapply)
}

/**
  * Data access object for the mission_type table
  */
object MissionTypeTable {
  val db = play.api.db.slick.DB
  val missionTypes = TableQuery[MissionTypeTable]

  val onboardingTypes: List[String] = List("auditOnboarding", "validationOnboarding")
  val onboardingTypeIds: List[Int] = db.withSession { implicit session =>
    missionTypes.filter(_.missionType inSet onboardingTypes).map(_.missionTypeId).list
  }

  /**
    * Gets the mission type id from the mission type name
    *
    * @param missionType    Name field for this mission type
    * @return               ID associated with this mission type
    */
  def missionTypeToId(missionType: String): Int = db.withTransaction { implicit session =>
    missionTypes.filter(_.missionType === missionType).map(_.missionTypeId).list.head
  }

  /**
    * Gets the mission type name from the mission type id
    *
    * @param missionTypeId  ID associated with this mission type
    * @return               Name field for this mission type
    */
  def missionTypeIdToMissionType(missionTypeId: Int): String = db.withTransaction { implicit session =>
    missionTypes.filter(_.missionTypeId === missionTypeId).map(_.missionType).list.head
  }

  /**
    * Saves a new mission type in the table
    * @param missionType
    * @return
    */
  def save(missionType: MissionType): Int = db.withTransaction { implicit session =>
    val missionTypeId: Int = (missionTypes returning missionTypes.map(_.missionTypeId)) += missionType
    missionTypeId
  }
}
