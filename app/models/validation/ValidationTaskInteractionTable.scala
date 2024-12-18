package models.validation

import com.google.inject.ImplementedBy
import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import java.sql.Timestamp
import javax.inject.{Inject, Singleton}


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
                                     timestamp: Timestamp,
                                     source: String) {
  require(List("ValidateDesktop", "ValidateDesktopAdmin", "ValidateDesktopNew", "ValidateMobile").contains(source), "Invalid source for validation_task_interaction table.")
}

class ValidationTaskInteractionTableDef(tag: slick.lifted.Tag) extends Table[ValidationTaskInteraction](tag, "validation_task_interaction") {
  def validationTaskInteractionId: Rep[Int] = column[Int]("validation_task_interaction_id", O.PrimaryKey, O.AutoInc)
  def missionId: Rep[Option[Int]] = column[Option[Int]]("mission_id")
  def action: Rep[String] = column[String]("action")
  def gsvPanoramaId: Rep[Option[String]] = column[Option[String]]("gsv_panorama_id")
  def lat: Rep[Option[Float]] = column[Option[Float]]("lat")
  def lng: Rep[Option[Float]] = column[Option[Float]]("lng")
  def heading: Rep[Option[Float]] = column[Option[Float]]("heading")
  def pitch: Rep[Option[Float]] = column[Option[Float]]("pitch")
  def zoom: Rep[Option[Float]] = column[Option[Float]]("zoom")
  def note: Rep[Option[String]] = column[Option[String]]("note")
  def timestamp: Rep[Timestamp] = column[Timestamp]("timestamp")
  def source: Rep[String] = column[String]("source")

  def * = (validationTaskInteractionId, missionId, action, gsvPanoramaId, lat,
    lng, heading, pitch, zoom, note, timestamp, source) <> ((ValidationTaskInteraction.apply _).tupled, ValidationTaskInteraction.unapply)

//  def mission: ForeignKeyQuery[MissionTable, Mission] =
//    foreignKey("validation_task_interaction_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
}

@ImplementedBy(classOf[ValidationTaskInteractionTable])
trait ValidationTaskInteractionTableRepository {
}

@Singleton
class ValidationTaskInteractionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends ValidationTaskInteractionTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val validationTaskInteractions = TableQuery[ValidationTaskInteractionTableDef]

//  def save(interaction: ValidationTaskInteraction): Int = {
//    val interactionId: Int =
//      (validationTaskInteractions returning validationTaskInteractions.map(_.validationTaskInteractionId)).insert(interaction)
//    interactionId
//  }
//
//  /**
//    * Inserts a sequence of interactions into the validation_task_interaction table.
//    */
//  def saveMultiple(interactions: Seq[ValidationTaskInteraction]): Seq[Int] = {
//    (validationTaskInteractions returning validationTaskInteractions.map(_.validationTaskInteractionId)) ++= interactions
//  }
}
