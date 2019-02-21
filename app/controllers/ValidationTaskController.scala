package controllers

import java.sql.Timestamp
import java.util.UUID
import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.ValidationTaskSubmissionFormats._
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.gsv.{GSVData, GSVDataTable, GSVLink, GSVLinkTable}
import models.label._
import models.label.LabelValidationTable._
import models.label.LabelTable.LabelValidationMetadata
import models.mission.{Mission, MissionTable}
import models.user.{User, UserCurrentRegionTable}
import models.validation._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._

import scala.concurrent.Future
import scala.collection.mutable.ListBuffer

class ValidationTaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  case class ValidationTaskPostReturnValue(hasMissionAvailable: Option[Boolean], mission: Option[Mission], labels: Option[JsValue])

  /**
    * Parse submitted validation data and submit to tables
    * Useful info: https://www.playframework.com/documentation/2.6.x/ScalaJsonHttp
    * BodyParsers.parse.json in async
    */
  def post = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[Seq[ValidationTaskSubmission]]
    println("[ValidationTaskController] request.body: " + request.body)
    println("[ValidationTaskController] submission: " + submission)
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val user = request.identity
        val returnValues: Seq[ValidationTaskPostReturnValue] = for (data <- submission) yield {
          for (interaction: InteractionSubmission <- data.interactions) {
            ValidationTaskInteractionTable.save(ValidationTaskInteraction(0, interaction.missionId, interaction.action,
              interaction.gsvPanoramaId, interaction.lat, interaction.lng, interaction.heading, interaction.pitch,
              interaction.zoom, interaction.note, new Timestamp(interaction.timestamp)))
          }

          for (label: LabelValidationSubmission <- data.labels) {
            user match {
              case Some(user) =>
                LabelValidationTable.save(LabelValidation(0, label.labelId, label.validationResult,
                  user.userId.toString, label.missionId, label.canvasX, label.canvasY, label.heading,
                  label.pitch, label.zoom, label.canvasHeight, label.canvasWidth,
                  new Timestamp(label.startTimestamp), new Timestamp(label.endTimestamp)))
              case None =>
                Logger.warn("User without user_id validated a label, but every user should have a user_id.")
            }
          }

          val missionId: Int = data.missionProgress.missionId
          val labelTypeId: Option[Int] = getLabelTypeId(user, data.missionProgress)

          println("[ValidationTaskController] labelTypeId is: " + labelTypeId)
          labelTypeId match {
            case Some(labelTypeId) =>
              println("[ValidationTaskController] labelTypeId exists")
              val possibleNewMission: Option[Mission] = updateMissionTable(user, data.missionProgress, labelTypeId)
              val labelList: Option[JsValue] = getLabelList(user, data.missionProgress, labelTypeId)
              ValidationTaskPostReturnValue(Some(true), possibleNewMission, labelList)
            case None =>
              if (data.missionProgress.completed) {
                println("[ValidationTaskController] tried to fetch a mission but failed")
                ValidationTaskPostReturnValue(None, None, None)
              } else {
                println("[ValidationTaskController] incomplete mission, do nothing")
                ValidationTaskPostReturnValue(Some(true), None, None)
              }
          }
        }

        Future.successful(Ok(Json.obj(
          "hasMissionAvailable" -> returnValues.head.hasMissionAvailable,
          "mission" -> returnValues.head.mission.map(_.toJSON),
          "labels" -> returnValues.head.labels
        )))
      }
    )
  }

  def getLabelTypeId(user: Option[User], missionProgress: ValidationMissionProgress): Option[Int] = {
    if (missionProgress.completed) {
      println("[ValidationTaskController] Attempting to get a labelTypeId")
      val possibleLabelTypeIds: ListBuffer[Int] = LabelTable.retrievePossibleLabelTypeIds(user.get.userId, 10)
      val hasNextMission: Boolean = possibleLabelTypeIds.length > 0
      println("[ValidationTaskController] possibleLabelTypeIds.length: " + possibleLabelTypeIds.length)
      if (hasNextMission) {
        val index: Int = scala.util.Random.nextInt(possibleLabelTypeIds.size)
        println("Index: " + index)
        println("[ValidationTaskController] Returning: " + possibleLabelTypeIds(index))
        return Some(possibleLabelTypeIds(index))
      }
    }
    None
  }

  /**
    * Gets the metadata for a specific label in the database.
    * @param labelId  label_id for this label
    * @return Label metadata containing GSV metadata and label type
    */
  def getLabelData(labelId: Int) = UserAwareAction.async { implicit request =>
    LabelTable.find(labelId) match {
      case Some(labelPointObj) =>
        val labelMetadata: LabelValidationMetadata = LabelTable.retrieveSingleLabelForValidation(labelId)
        val labelMetadataJson: JsObject = LabelTable.validationLabelMetadataToJson(labelMetadata)
        Future.successful(Ok(labelMetadataJson))
      case _ => Future.successful(Ok(Json.obj("error" -> "no such label")))
    }
  }

  /**
    * Gets a list of new labels to validate if the mission is complete.
    * @param user
    * @param missionProgress  Metadata for this mission
    * @return                 List of label metadata (if this mission is complete).
    */
  def getLabelList(user: Option[User], missionProgress: ValidationMissionProgress, labelTypeId: Int): Option[JsValue] = {
    val userId: UUID = user.get.userId
    if (missionProgress.completed) {
      val labelCount: Int = MissionTable.getNextValidationMissionLabelCount(userId)
      Some(getLabelListForValidation(userId, labelCount, labelTypeId))
    } else {
      None
    }
  }
  
  /**
    * Gets a random list of labels to validate for this mission.
    * @param count  Number of labels to retrieve for this list.
    * @param labelTypeId Label Type to retrieve
    * @return       JsValue containing a list of labels with the following attributes:
    *               {label_id, label_type, gsv_panorama_id, heading, pitch, zoom, canvas_x, canvas_y,
    *               canvas_width, canvas_height}
    */
  def getLabelListForValidation(userId: UUID, count: Int, labelTypeId: Int): JsValue = {
    val labelMetadata: Seq[LabelValidationMetadata] = LabelTable.retrieveRandomLabelListForValidation(userId, count)
    val labelMetadataJsonSeq: Seq[JsObject] = labelMetadata.map(label => LabelTable.validationLabelMetadataToJson(label))
    val labelMetadataJson : JsValue = Json.toJson(labelMetadataJsonSeq)
    labelMetadataJson
  }

  /**
    * Gets the metadata for a single random label in the database.
    * @param labelType  Label Type Id this label should have
    * @return           Label metadata containing GSV metadata and label type
    */
  def getRandomLabelData (labelType: Int) = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    println("[getRandomLabelData] request.body: " + request.body)
    var submission = request.body.validate[Seq[SkipLabelSubmission]]
    println("[getRandomLabelData] Submission: " + submission)
    submission.fold(
      errors => {
        println("Errors")
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        var labelIdList = new ListBuffer[Int]()

        val labelMetadataJson: Seq[JsObject] = for (data <- submission) yield {
          for (label: LabelValidationSubmission <- data.labels) {
            labelIdList += label.labelId
          }
          println("Label Ids: " + labelIdList)
          val userId: UUID = request.identity.get.userId

          val labelMetadata: LabelValidationMetadata = LabelTable.retrieveSingleRandomLabelFromLabelTypeForValidation(userId, labelType, Some(labelIdList))
          LabelTable.validationLabelMetadataToJson(labelMetadata)
        }
        Future.successful(Ok(labelMetadataJson.head))
      }
    )
  }

  /**
    * Updates the MissionTable. If the current mission is completed, then retrieves a new mission.
    * @param user
    * @param missionProgress  Metadata for this mission
    * @return
    */
  def updateMissionTable(user: Option[User], missionProgress: ValidationMissionProgress, labelTypeId: Int): Option[Mission] = {
    val missionId: Int = missionProgress.missionId
    val skipped: Boolean = missionProgress.skipped
    val userId: UUID = user.get.userId
    val role: String = user.get.role.getOrElse("")
    val labelsProgress: Int = missionProgress.labelsProgress

    if (missionProgress.completed) {
      println("[ValidationTaskController] mission is completed")
      // payPerLabel is currently always 0 because this is only available to volunteers.
      val payPerLabel: Double = AMTAssignmentTable.VOLUNTEER_PAY
      MissionTable.updateCompleteAndGetNextValidationMission(userId, payPerLabel, missionId, labelsProgress, labelTypeId, skipped)
    } else {
      println("[ValidationTaskController] mission is incomplete")
      MissionTable.updateValidationProgressOnly(userId, missionId, labelsProgress)
    }
  }
}
