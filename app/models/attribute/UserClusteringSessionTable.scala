package models.attribute

import com.google.inject.ImplementedBy
import models.audit.AuditTaskTableDef
import models.label.{LabelPointTableDef, LabelTableDef, LabelTypeTableDef}
import models.mission.MissionTableDef
import models.region.RegionTableDef
import models.user.UserStatTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class LabelToCluster(userId: String, labelId: Int, labelType: String, lat: Float, lng: Float, severity: Option[Int])

case class UserClusteringSession(userClusteringSessionId: Int, userId: String, timeCreated: OffsetDateTime)

class UserClusteringSessionTableDef(tag: Tag) extends Table[UserClusteringSession](tag, "user_clustering_session") {
  def userClusteringSessionId: Rep[Int] = column[Int]("user_clustering_session_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def timeCreated: Rep[OffsetDateTime] = column[OffsetDateTime]("time_created")

  def * = (userClusteringSessionId, userId, timeCreated) <>
    ((UserClusteringSession.apply _).tupled, UserClusteringSession.unapply)

//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("user_clustering_session_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
}

@ImplementedBy(classOf[UserClusteringSessionTable])
trait UserClusteringSessionTableRepository { }

@Singleton
class UserClusteringSessionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
  extends UserClusteringSessionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {

  import profile.api._

  val userClusteringSessions = TableQuery[UserClusteringSessionTableDef]
  val missionTable = TableQuery[MissionTableDef]
  val regionTable = TableQuery[RegionTableDef]
  val labelTable = TableQuery[LabelTableDef]
  val labelTypeTable = TableQuery[LabelTypeTableDef]
  val auditTaskTable = TableQuery[AuditTaskTableDef]
  val userStatTable = TableQuery[UserStatTableDef]
  val labelPointTable = TableQuery[LabelPointTableDef]
  val userAttributeTable = TableQuery[UserAttributeTableDef]
  val globalAttributeUserAttributeTable = TableQuery[GlobalAttributeUserAttributeTableDef]

  /**
   * Returns labels that were placed by the specified user in the format needed for clustering.
   */
  def getUserLabelsToCluster(userId: String): DBIO[Seq[LabelToCluster]] = {
    labelsForApiQuery.filter(_._1 === userId).result.map(_.map(LabelToCluster.tupled))
  }

  // Get labels that should be in the API. Labels from high quality users that haven't been explicitly marked as
  // incorrect should be included, plus labels from low quality users that have been explicitly marked as correct.
  def labelsForApiQuery: Query[(Rep[String], Rep[Int], Rep[String], Rep[Float], Rep[Float], Rep[Option[Int]]), (String, Int, String, Float, Float, Option[Int]), Seq] = for {
    _mission <- missionTable
    _region <- regionTable if _mission.regionId === _region.regionId
    _userStat <- userStatTable if _mission.userId === _userStat.userId
    _lab <- labelTable if _lab.missionId === _mission.missionId
    _task <- auditTaskTable if _lab.auditTaskId === _task.auditTaskId
    _latlng <- labelPointTable if _lab.labelId === _latlng.labelId
    _type <- labelTypeTable if _lab.labelTypeId === _type.labelTypeId
    if _region.deleted === false
    if _lab.correct || (_userStat.highQuality && _lab.correct.isEmpty && !_task.lowQuality)
    if _latlng.lat.isDefined && _latlng.lng.isDefined
  } yield (_mission.userId, _lab.labelId, _type.labelType, _latlng.lat.ifNull(-1F), _latlng.lng.ifNull(-1F), _lab.severity)

  /**
   * Gets all clusters from single-user clustering that are in this region, outputs in format needed for clustering.
   */
  def getClusteredLabelsInRegion(regionId: Int): DBIO[Seq[LabelToCluster]] = {
    (for {
      _sess <- userClusteringSessions
      _att <- userAttributeTable if _sess.userClusteringSessionId === _att.userClusteringSessionId
      _type <- labelTypeTable if _att.labelTypeId === _type.labelTypeId
      if _att.regionId === regionId
    } yield (_sess.userId, _att.userAttributeId, _type.labelType, _att.lat, _att.lng, _att.severity))
      .result.map(_.map(LabelToCluster.tupled))
  }

  /**
   * Deletes the entries in the `user_clustering_session` table and (almost) all connected data for the given users.
   *
   * Deletes the entry in the `user_clustering_session` table, and the connected entries in the `user_attribute`,
   * `user_attribute_label`, and `global_attribute_user_attribute` tables. Data in `global_clustering_session` and
   * `global_attribute` are deleted in a separate method.
   */
  def deleteUserClusteringSessions(usersToDelete: Seq[String]): DBIO[Int] = {
    userClusteringSessions.filter(_.userId inSetBind usersToDelete).delete
  }

  def insert(newSess: UserClusteringSession): DBIO[Int] = {
    (userClusteringSessions returning userClusteringSessions.map(_.userClusteringSessionId)) += newSess
  }
}
