package models.attribute

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.{LabelTable, LabelTypeTable}
import models.mission.MissionTable
import models.region.RegionTable
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
      _mission <- MissionTable.missions if _mission.userId === userId
      _region <- RegionTable.regions if _mission.regionId === _region.regionId
      _lab <- LabelTable.labelsWithoutDeletedOrOnboarding if _lab.missionId === _mission.missionId
      _latlng <- LabelTable.labelPoints if _lab.labelId === _latlng.labelId
      _type <- LabelTable.labelTypes if _lab.labelTypeId === _type.labelTypeId
      if _region.deleted === false &&
        (_lab.correct.isEmpty || _lab.correct === true) // Filter out labels validated as incorrect.
    } yield (_mission.userId, _lab.labelId, _type.labelType, _latlng.lat, _latlng.lng, _lab.severity, _lab.temporary)

    labels.list.map(LabelToCluster.tupled)
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

  /**
   * Deletes the entries in the `user_clustering_session` table and (almost) all connected data for the given users.
   *
   * Deletes the entry in the `user_clustering_session` table, and the connected entries in the `user_attribute`,
   * `user_attribute_label`, and `global_attribute_user_attribute` tables. We leave the data in the `global_attribute`
   * alone. Since we can't use a join in a delete statement and the `user_attribute` table has foreign key constraints
   * on both the `user_clustering_session` and `global_attribute_user_attribute` tables, we have to start by getting the
   * list of `user_attribute_id`s to delete from the `global_attribute_user_attribute` first; then we can use
   * `DELETE CASCADE` on the `user_clustering_session` table.
   */
  def deleteUsersClusteringSessions(usersToDelete: List[String]): Int = db.withTransaction { implicit session =>
    // Get list of `user_attribute_id`s to delete from the `global_attribute_user_attribute` table.
    val userAttributesToDelete: List[Int] = userClusteringSessions
      .innerJoin(UserAttributeTable.userAttributes).on(_.userClusteringSessionId === _.userClusteringSessionId)
      .filter(_._1.userId inSet usersToDelete)
      .map(_._2.userAttributeId).list

    // DELETE entries in `global_attribute_user_attribute` and then DELETE CASCADE entries in `user_clustering_session`.
    val nGlobalAttributeLinksDeleted: Int = GlobalAttributeUserAttributeTable.globalAttributeUserAttributes
      .filter(_.userAttributeId inSet userAttributesToDelete)
      .delete
    userClusteringSessions.filter(_.userId inSet usersToDelete).delete
  }

  def save(newSess: UserClusteringSession): Int = db.withTransaction { implicit session =>
    val newId: Int = (userClusteringSessions returning userClusteringSessions.map(_.userClusteringSessionId)) += newSess
    newId
  }
}
