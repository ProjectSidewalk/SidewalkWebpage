package models.validation

import java.util.UUID

import models.mission.{Mission, MissionTable}
import models.street.StreetEdgeTable
import models.utils.MyPostgresDriver.api._
import play.api.Play
import play.api.db.slick.DatabaseConfigProvider

import slick.driver.JdbcProfile
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import play.extras.geojson

import scala.concurrent.Future


case class ValidationTaskInteraction(validationTaskInteractionId: Int,
                                     missionId: Int,
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
  def missionId = column[Int]("mission_id")
  def action = column[String]("action")
  def gsvPanoramaId = column[Option[String]]("gsv_panorama_id")
  def lat = column[Option[Float]]("lat")
  def lng = column[Option[Float]]("lng")
  def heading = column[Option[Float]]("heading")
  def pitch = column[Option[Float]]("pitch")
  def zoom = column[Option[Float]]("zoom")
  def note = column[Option[String]]("note")
  def timestamp = column[java.sql.Timestamp]("timestamp")

  def * = (validationTaskInteractionId, missionId, action, gsvPanoramaId, lat,
    lng, heading, pitch, zoom, note, timestamp) <> ((ValidationTaskInteraction.apply _).tupled, ValidationTaskInteraction.unapply)

  def mission = foreignKey("validation_task_interaction_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

object ValidationTaskInteractionTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val validationTaskInteractions = TableQuery[ValidationTaskInteractionTable]

  def save(interaction: ValidationTaskInteraction): Future[Int] = db.run {
    (validationTaskInteractions returning validationTaskInteractions.map(_.validationTaskInteractionId)) += interaction
  }
}
