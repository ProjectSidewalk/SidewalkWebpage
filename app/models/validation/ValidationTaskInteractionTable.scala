package models.validation

import java.util.UUID
import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import play.extras.geojson

import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.slick.lifted.ForeignKeyQuery


case class ValidationTaskInteraction(validationTaskInteractionId: Int,
                                     missionId: Option[Int],
                                     action: String,
                                     gsvPanoramaId: Option[String],
                                     lat: Option[Float],
                                     lng: Option[Float],
                                     heading: Option[Float],
                                     pitch: Option[Float],
                                     zoom: Option[Float],
                                     note: Option[String],
                                     timestamp: java.sql.Timestamp)

class ValidationTaskInteractionTable(tag: slick.lifted.Tag) extends Table[ValidationTaskInteraction](tag, Some("sidewalk"), "validation_task_interaction") {
  def validationTaskInteractionId = column[Int]("validation_task_interaction_id", O.PrimaryKey, O.AutoInc)
  def missionId = column[Option[Int]]("mission_id", O.Nullable)
  def action = column[String]("action", O.NotNull)
  def gsvPanoramaId = column[Option[String]]("gsv_panorama_id", O.Nullable)
  def lat = column[Option[Float]]("lat", O.Nullable)
  def lng = column[Option[Float]]("lng", O.Nullable)
  def heading = column[Option[Float]]("heading", O.Nullable)
  def pitch = column[Option[Float]]("pitch", O.Nullable)
  def zoom = column[Option[Float]]("zoom", O.Nullable)
  def note = column[Option[String]]("note", O.Nullable)
  def timestamp = column[java.sql.Timestamp]("timestamp", O.NotNull)

  def * = (validationTaskInteractionId, missionId, action, gsvPanoramaId, lat,
    lng, heading, pitch, zoom, note, timestamp) <> ((ValidationTaskInteraction.apply _).tupled, ValidationTaskInteraction.unapply)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("validation_task_interaction_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

object ValidationTaskInteractionTable {
  val db = play.api.db.slick.DB
  val validationTaskInteractions = TableQuery[ValidationTaskInteractionTable]

  def save(interaction: ValidationTaskInteraction): Int = db.withTransaction { implicit session =>
    val interactionId: Int =
      (validationTaskInteractions returning validationTaskInteractions.map(_.validationTaskInteractionId)).insert(interaction)
    interactionId
  }

  /**
    * Inserts a sequence of interactions into the validation_task_interaction table.
    *
    * @param interactions
    * @return
    */
  def saveMultiple(interactions: Seq[ValidationTaskInteraction]): Seq[Int] = db.withTransaction { implicit session =>
    (validationTaskInteractions returning validationTaskInteractions.map(_.validationTaskInteractionId)) ++= interactions
  }
}
