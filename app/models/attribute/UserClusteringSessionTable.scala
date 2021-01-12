package models.attribute

import models.audit.AuditTaskTable
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{LabelTable, LabelTypeTable, LabelTemporarinessTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick
import play.api.libs.json.{JsObject, Json}
import scala.slick.lifted.{ForeignKeyQuery, ProvenShape, Tag}
import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.language.postfixOps

case class LabelToCluster(userId: String,
                          labelId: Int,
                          labelType: String,
                          lat: Option[Float],
                          lng: Option[Float],
                          severity: Option[Int],
                          temporary: Boolean) {
  /**
    * Converts the data into the JSON format.
    *
    * @return
    */
  def toJSON: JsObject = {
    Json.obj(
      "user_id" -> userId,
      "label_id" -> labelId,
      "label_type" -> labelType,
      "lat" -> lat,
      "lng" -> lng,
      "severity" -> severity,
      "temporary" -> temporary
    )
  }
}

case class UserClusteringSession(userClusteringSessionId: Int, userId: String, timeCreated: java.sql.Timestamp)

class UserClusteringSessionTable(tag: Tag) extends Table[UserClusteringSession](tag, Some("sidewalk"), "user_clustering_session") {
  def userClusteringSessionId: Column[Int] = column[Int]("user_clustering_session_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def userId: Column[String] = column[String]("user_id", O.NotNull)
  def timeCreated: Column[java.sql.Timestamp] = column[java.sql.Timestamp]("time_created", O.NotNull)

  def * : ProvenShape[UserClusteringSession] = (userClusteringSessionId, userId, timeCreated) <>
    ((UserClusteringSession.apply _).tupled, UserClusteringSession.unapply)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("user_clustering_session_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

/**
  * Data access object for the UserClusteringSessionTable table.
  */
object UserClusteringSessionTable {
  val db: slick.Database = play.api.db.slick.DB
  val userClusteringSessions: TableQuery[UserClusteringSessionTable] = TableQuery[UserClusteringSessionTable]

  implicit val labelToClusterConverter = GetResult[LabelToCluster](r => {
    LabelToCluster(r.nextString, r.nextInt, r.nextString, r.nextFloatOption, r.nextFloatOption, r.nextIntOption, r.nextBoolean)
  })

  /**
    * Returns labels that were placed by the specified user in the format needed for clustering.
    */
  def getUserLabelsToCluster(userId: String): List[LabelToCluster] = db.withSession { implicit session =>

    // Gets all non-deleted, non-tutorial labels placed by the specified user.
    val labels = for {
      _task <- AuditTaskTable.auditTasks if _task.userId === userId
      _lab <- LabelTable.labelsWithoutDeletedOrOnboarding if _lab.auditTaskId === _task.auditTaskId
      _latlng <- LabelTable.labelPoints if _lab.labelId === _latlng.labelId
      _type <- LabelTable.labelTypes if _lab.labelTypeId === _type.labelTypeId
    } yield (_task.userId, _lab.labelId, _type.labelType, _latlng.lat, _latlng.lng)

    // Left joins to get severity for any labels that have them.
    val labelsWithSeverity = for {
      (_lab, _severity) <- labels.leftJoin(LabelTable.severities).on(_._2 === _.labelId)
    } yield (_lab._1, _lab._2, _lab._3, _lab._4, _lab._5, _severity.severity.?)

    // Left joins to get temporariness for any labels that have them (those that don't are marked as temporary=false).
    val labelsWithTemporariness = for {
      (_lab, _temp) <- labelsWithSeverity.leftJoin(LabelTemporarinessTable.labelTemporarinesses).on(_._2 === _.labelId)
    } yield (_lab._1, _lab._2, _lab._3, _lab._4, _lab._5, _lab._6, _temp.temporary.?.getOrElse(false))

    labelsWithTemporariness.list.map(LabelToCluster.tupled)
  }

  /**
    * Gets all clusters from single-user clustering that are in this region, outputs in format needed for clustering.
    */
  def getClusteredLabelsInRegion(regionId: Int): List[LabelToCluster] = db.withTransaction { implicit session =>
    val labelsInRegion = for {
      _sess <- userClusteringSessions
      _att <- UserAttributeTable.userAttributes if _sess.userClusteringSessionId === _att.userClusteringSessionId
      _type <- LabelTypeTable.labelTypes if _att.labelTypeId === _type.labelTypeId
      if _att.regionId === regionId
    } yield (
      _sess.userId,
      _att.userAttributeId,
      _type.labelType,
      _att.lat.?,
      _att.lng.?,
      _att.severity,
      _att.temporary
    )

    labelsInRegion.list.map(LabelToCluster.tupled)
  }

  /**
    * Truncates user_clustering_session, user_attribute, user_attribute_label, and global_attribute_user_attribute.
    */
  def truncateTables(): Unit = db.withTransaction { implicit session =>
    Q.updateNA("TRUNCATE TABLE user_clustering_session CASCADE").execute
  }

  def save(newSess: UserClusteringSession): Int = db.withTransaction { implicit session =>
    val newId: Int = (userClusteringSessions returning userClusteringSessions.map(_.userClusteringSessionId)) += newSess
    newId
  }
}
