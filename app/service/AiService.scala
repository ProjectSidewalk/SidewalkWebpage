package service

import com.google.inject.ImplementedBy
import models.label._
import models.user.SidewalkUserTable
import models.utils.MyPostgresProfile.api._
import models.utils._
import models.validation.LabelValidation
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsObject, JsValue}
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}
import slick.dbio.DBIO

import java.time.format.DateTimeFormatter
import java.time.{LocalDate, OffsetDateTime, ZoneOffset}
import javax.inject._
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

@ImplementedBy(classOf[AiServiceImpl])
trait AiService {

  /**
   * Validates labels using AI by fetching label metadata, calling the AI API, and saving results.
   * @param labelIds A sequence of label_ids to validate
   * @return A Future containing a sequence of LabelAiAssessment objects with validation results and tags
   */
  def validateLabelsWithAi(labelIds: Seq[Int]): Future[Seq[Option[LabelAiAssessment]]]

  /**
   * Validates n highest priority labels using AI by fetching label metadata, calling the AI API, and saving results.
   * @param n The number of labels to validate
   * @return A Future containing a sequence of LabelAiAssessment objects with validation results and tags
   */
  def validateLabelsWithAiDaily(n: Int): Future[Seq[Option[LabelAiAssessment]]]
}

@Singleton
class AiServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    ws: WSClient,
    configService: ConfigService,
    labelTable: models.label.LabelTable,
    validationService: ValidationService,
    labelAiAssessmentTable: models.label.LabelAiAssessmentTable,
    missionTable: models.mission.MissionTable,
    gsvDataService: GsvDataService
)(implicit val ec: ExecutionContext)
    extends AiService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger                         = Logger(this.getClass)
  private val cityId: String                 = config.get[String]("city-id")
  private val AI_ENABLED: Boolean            = config.get[Boolean]("ai-enabled")
  private val AI_VALIDATIONS_ON: Boolean     = config.get[Boolean](s"city-params.ai-validation-enabled.$cityId")
  private val AI_TAG_SUGGESTIONS_ON: Boolean = config.get[Boolean](s"city-params.ai-tag-suggestions-enabled.$cityId")
  private val AI_VALIDATION_MIN_ACCURACY: Double = config.get[Double](s"city-params.ai-validation-min-accuracy.$cityId")

  def validateLabelsWithAi(labelIds: Seq[Int]): Future[Seq[Option[LabelAiAssessment]]] = {
    if (AI_ENABLED && (AI_VALIDATIONS_ON || AI_TAG_SUGGESTIONS_ON)) {
      Future.sequence {
        labelIds.map { labelId =>
          // Fetch label metadata from the database.
          db.run(labelTable.getLabelDataForAi(labelId))
            .flatMap {
              // Call the AI API to process the panorama data and validate labels.
              case Some(labelData) => callAiApiAndSubmitData(labelData)
              case None            =>
                logger.warn(s"Info for label with ID $labelId not found.")
                Future.failed(new Exception(s"Label with ID $labelId not found."))
            }
        }
      }
    } else {
      logger.info("AI validations or tag suggestions are disabled for this city.")
      Future.successful(Seq.empty[Option[LabelAiAssessment]])
    }
  }

  def validateLabelsWithAiDaily(n: Int): Future[Seq[Option[LabelAiAssessment]]] = {
    if (AI_ENABLED && (AI_VALIDATIONS_ON || AI_TAG_SUGGESTIONS_ON)) {
      db.run(labelTable.getLabelsToValidateWithAi(n)).flatMap { labelDataSeq =>
        Future.sequence {
          labelDataSeq.map { labelData =>
            callAiApiAndSubmitData(labelData) // Call the AI API to process the panorama data and validate the label.
          }
        }
      }
    } else {
      logger.info("AI validations or tag suggestions are disabled for this city.")
      Future.successful(Seq.empty)
    }
  }

  /**
   * Calls the AI API to validate the label, then saves results and submits validation if applicable.
   * @param labelData The label data containing panorama and label information
   * @return A Future containing an optional LabelAiAssessment object, None if API call failed
   */
  private def callAiApiAndSubmitData(labelData: LabelDataForAi): Future[Option[LabelAiAssessment]] = {
    val startTime    = OffsetDateTime.now
    val labelId: Int = labelData.labelId

    // Call the AI API to process the panorama data and validate the label.
    callAiApi(labelData).map(_.map(aiResults => (aiResults, labelData))).flatMap {
      case None => Future.successful(None) // No AI results; callAiApi already logs all errors.
      // Save AI results to the database and submit validation if applicable.
      case Some((aiResults, labelData)) =>
        logger.debug(aiResults.toString)

        // Add AI information to the label_ai_assessment table.
        val saveAiAssessmentAction = db.run(labelAiAssessmentTable.save(aiResults))
        saveAiAssessmentAction.onComplete(x => {
          if (x.isFailure) {
            logger.warn(s"Failed to save AI results for label ${labelId}: ${x.failed.get.getMessage}")
          }
        })

        // If AI validations are enabled and confidence is above the threshold, submit a validation.
        val submitValidationAction: Future[Option[Int]] =
          if (AI_VALIDATIONS_ON && aiResults.validationAccuracy >= AI_VALIDATION_MIN_ACCURACY) {
            val labelPoint = labelData.labelPoint

            // Get the AI's mission_id and the label's current info, then create and submit the validation.
            db.run((for {
              aiMissionId: Int <- getAiValidateMissionId(labelData.labelTypeId)
              label: Label     <- labelTable.find(labelId).map(_.get) // If we got this far, we know label exists.
              validation: LabelValidation = LabelValidation(
                0, labelId, aiResults.validationResult, label.severity, label.severity, label.tags, label.tags,
                SidewalkUserTable.aiUserId, aiMissionId, Some(labelPoint.canvasX), Some(labelPoint.canvasY),
                labelPoint.heading, labelPoint.pitch, labelPoint.zoom.toFloat, LabelPointTable.canvasWidth,
                LabelPointTable.canvasHeight, startTime, aiResults.timestamp, "SidewalkAI"
              )
              valId: Option[Int] <- validationService
                .submitValidationsDbio(
                  Seq(ValidationSubmission(validation, comment = None, undone = false, redone = false))
                )
                .map(_.headOption)
            } yield valId).transactionally)
          } else Future.successful(Option.empty[Int])

        // Run both actions in parallel and return the AI results.
        saveAiAssessmentAction.zip(submitValidationAction).map(_ => Some(aiResults))
    }
  }

  /**
   * Calls the AI API to process panorama data and validate labels.
   * @param labelData The label data containing panorama and label information
   * @throws Exception if the API call fails or the response cannot be parsed.
   * @return A Future containing an optional LabelAiAssessment object.
   */
  private def callAiApi(labelData: LabelDataForAi): Future[Option[LabelAiAssessment]] = {
    val SIDEWALK_AI_API_HOSTNAME: String = config.get[String]("sidewalk-ai-api-hostname")
    val url: String                      = s"https://${SIDEWALK_AI_API_HOSTNAME}/process"
    val labelId: Int                     = labelData.labelId

    // Create form data for the multipart request.
    val formData = Map(
      "label_type"  -> LabelTypeEnum.labelTypeIdToLabelType(labelData.labelTypeId).toLowerCase,
      "panorama_id" -> labelData.gsvData.gsvPanoramaId,
      "x"           -> (labelData.labelPoint.panoX.toDouble / labelData.gsvData.width.get).toString,
      "y"           -> (labelData.labelPoint.panoY.toDouble / labelData.gsvData.height.get).toString
    )

    ws.url(url)
      .post(formData)
      .map { response =>
        try {
          if (response.status >= 200 && response.status < 300) {
            val json: JsValue = response.json
            logger.debug(json.toString)

            // Parse the output. Filter out "NULL" values from the tags list.
            val valResult     = if ((json \ "validation_result").as[String] == "correct") 1 else 2
            val valAccuracy   = (json \ "validation_estimated_accuracy").as[Double]
            val valConfidence = (json \ "validation_score").as[Double]
            val tagsConfidence: Option[Seq[AiTagConfidence]] = (json \ "tag_scores")
              .asOpt[JsObject]
              .map(_.fields.map { case (tag, jsValue) => AiTagConfidence(tag, jsValue.as[Double]) }.toSeq)
            val tags          = (json \ "tags").asOpt[List[String]].map(tags => tags.filter(tag => tag != "NULL"))
            val apiVersion    = (json \ "api_version").as[String]
            val valModelId    = (json \ "validator_model_id").as[String]
            val taggerModelId = (json \ "tagger_model_id").asOpt[String]

            // Read training dates.
            val dateFormatter   = DateTimeFormatter.ofPattern("MM-dd-yyyy")
            val valTrainingDate = LocalDate
              .parse((json \ "validator_training_date").as[String], dateFormatter)
              .atStartOfDay(ZoneOffset.UTC)
              .toOffsetDateTime
            val taggerTrainingDate = (json \ "tagger_training_date")
              .asOpt[String]
              .map(dateStr => LocalDate.parse(dateStr, dateFormatter).atStartOfDay(ZoneOffset.UTC).toOffsetDateTime)

            Some(
              LabelAiAssessment(0, labelData.labelId, valResult, valAccuracy, valConfidence, tags, tagsConfidence,
                apiVersion, valModelId, valTrainingDate, taggerModelId, taggerTrainingDate, OffsetDateTime.now)
            )
          } else {
            logger.warn(s"AI API for label $labelId returned error status: ${response.status} - ${response.statusText}")
            // Most common failure is for expired imagery, so do that check and mark it as expired here.
            Await.result(gsvDataService.panoExists(labelData.gsvData.gsvPanoramaId), 5.seconds)
            None
          }
        } catch {
          case e: Exception =>
            logger.warn(s"Failed to parse AI API response for label $labelId: ${e.getMessage}")
            None
        }
      }
      .recover { case e: Exception =>
        logger.warn(s"AI API request failed for label $labelId: ${e.getMessage}")
        None
      }
  }

  /**
   * Retrieves the AI validation mission_id from the db for a given label_type_id, cached since it doesn't change.
   * @param labelTypeId The ID of the label type for which to get the AI validation mission_id
   * @return A DBIO containing the AI validation mission_id
   */
  private def getAiValidateMissionId(labelTypeId: Int): DBIO[Int] =
    configService.cachedDBIO[Int](s"getAiValidateMissionId($labelTypeId)")(
      missionTable.getAiValidateMissionId(labelTypeId)
    )
}
