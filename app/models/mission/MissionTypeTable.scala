package models.mission

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class MissionType(missionTypeId: Int, missionType: String)

class MissionTypeTableDef(tag: slick.lifted.Tag) extends Table[MissionType](tag, "mission_type") {
  def missionTypeId: Rep[Int] = column[Int]("mission_type_id", O.PrimaryKey, O.AutoInc)
  def missionType: Rep[String] = column[String]("mission_type")

  def * = (missionTypeId, missionType) <> ((MissionType.apply _).tupled, MissionType.unapply)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object MissionTypeTable {
  val missionTypeToId: Map[String, Int] = Map("auditOnboarding" -> 1, "audit" -> 2, "validationOnboarding" -> 3, "validation" -> 4, "cvGroundTruth" -> 5, "labelmapValidation" -> 7)
  val missionTypeIdToMissionType: Map[Int, String] = missionTypeToId.map(_.swap)
  val onboardingTypes: Seq[String] = Seq("auditOnboarding", "validationOnboarding")
  val onboardingTypeIds: Seq[Int] = onboardingTypes.map(missionTypeToId)
}

@ImplementedBy(classOf[MissionTypeTable])
trait MissionTypeTableRepository { }

@Singleton
class MissionTypeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)
  extends MissionTypeTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  val missionTypes = TableQuery[MissionTypeTableDef]
}
