package service

import com.google.inject.ImplementedBy
import models.label.{LabelAi, LabelDataForAi, LabelPointTable, LabelTypeEnum}
import models.user.SidewalkUserTable
import models.utils._
import models.validation.LabelValidation
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.JsValue
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[AiServiceImpl])
trait AiService {
  def validateLabelsWithAi(labelIds: Seq[Int]): Future[Seq[LabelAi]]
}

@Singleton
class AiServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    ws: WSClient,
    cacheApi: AsyncCacheApi,
    labelTable: models.label.LabelTable,
    validationService: ValidationService,
    labelAiTable: models.label.LabelAiTable,
    missionTable: models.mission.MissionTable
)(implicit val ec: ExecutionContext)
    extends AiService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger                         = Logger(this.getClass)
  private val cityId: String                 = config.get[String]("city-id")
  private val AI_ENABLED: Boolean            = config.get[Boolean]("ai-enabled")
  private val AI_VALIDATIONS_ON: Boolean     = config.get[Boolean](s"city-params.ai-validation-enabled.$cityId")
  private val AI_TAG_SUGGESTIONS_ON: Boolean = config.get[Boolean](s"city-params.ai-tag-suggestions-enabled.$cityId")
  private val AI_VALIDATION_MIN_ACCURACY: Double = config.get[Double](s"city-params.ai-validation-min-accuracy.$cityId")

  /**
   * Validates labels using AI by fetching label metadata, calling the AI API, and saving results.
   * @param labelIds A sequence of label_ids to validate
   * @return A Future containing a sequence of LabelAi objects with validation results and tags
   */
  def validateLabelsWithAi(labelIds: Seq[Int]): Future[Seq[LabelAi]] = {
    if (AI_ENABLED && (AI_VALIDATIONS_ON || AI_TAG_SUGGESTIONS_ON)) {
      val startTime = OffsetDateTime.now
      Future.sequence {
        labelIds.map { labelId =>

          // Fetch label metadata from the database.
          db.run(labelTable.getLabelDataForAi(labelId))
            .flatMap {
              // Call the AI API to process the panorama data and validate labels.
              case Some(labelData) =>
                callAiApi(labelData).map(_.map(aiResults => (aiResults, labelData)))
              case None =>
                logger.warn(s"Info for label with ID $labelId not found.")
                Future.failed(new Exception(s"Label with ID $labelId not found."))
            }
            .flatMap {
              case None => Future.successful(None) // No AI results; callAiApi already logs all errors.

              // Save AI results to the database and submit validation if applicable.
              case Some((aiResults, labelData)) =>
                println(aiResults)
                // Add AI information to the label_ai table.
                val saveLabelAiAction = db.run(labelAiTable.save(aiResults))

              // If AI validations are enabled and confidence is above the threshold, submit a validation.
              val submitValidationAction = if (AI_VALIDATIONS_ON && aiResults.validationAccuracy >= AI_VALIDATION_MIN_ACCURACY) {
                val label      = labelData.label
                val labelPoint = labelData.labelPoint

                // Get the AI's mission_id, then create and submit the validation.
                getAiValidateMissionId(label.labelTypeId).flatMap { aiMissionId =>
                  println("aiMissionId: " + aiMissionId)
                  val validation = LabelValidation(
                    0, labelId, aiResults.validationResult, label.severity, label.severity, label.tags, label.tags,
                    SidewalkUserTable.aiUserId, aiMissionId, Some(labelPoint.canvasX), Some(labelPoint.canvasY),
                    labelPoint.heading, labelPoint.pitch, labelPoint.zoom.toFloat, LabelPointTable.canvasWidth,
                    LabelPointTable.canvasHeight, startTime, aiResults.timeCreated, "SidewalkAI"
                  )
                  validationService.submitValidations(
                    Seq(ValidationSubmission(validation, comment = None, undone = false, redone = false))
                  )
                }
              } else Future.successful(Seq.empty[Int])

                // Run both actions in parallel and return the AI results.
                saveLabelAiAction.zip(submitValidationAction).map(_ => Some(aiResults))
            }
        }
      }.map(_.flatten)
    } else {
      logger.info("AI validations or tag suggestions are disabled for this city.")
      Future.successful(Seq.empty)
    }
  }

  /**
   * Calls the AI API to process panorama data and validate labels.
   * @param labelData The label data containing panorama and label information
   * @throws Exception if the API call fails or the response cannot be parsed.
   * @return A Future containing an optional LabelAi object, including tags, validation result, accuracy, API version.
   */
  private def callAiApi(labelData: LabelDataForAi): Future[Option[LabelAi]] = {
    val SIDEWALK_AI_API_HOSTNAME: String = config.get[String]("sidewalk-ai-api-hostname")
    val url: String                      = s"https://${SIDEWALK_AI_API_HOSTNAME}/process"
    val labelId: Int                     = labelData.label.labelId

    // Create form data for the multipart request.
    val formData = Map(
      "label_type"  -> LabelTypeEnum.labelTypeIdToLabelType(labelData.label.labelTypeId).toLowerCase,
      "panorama_id" -> labelData.label.gsvPanoramaId,
      "x"           -> (labelData.labelPoint.panoX.toDouble / labelData.gsvData.width.get).toString,
      "y"           -> (labelData.labelPoint.panoY.toDouble / labelData.gsvData.height.get).toString
    )

    ws.url(url)
      .post(formData)
      .map { response =>
        try {
          if (response.status >= 200 && response.status < 300) {
            val json: JsValue = response.json
            println(json)

            // Parse the output. Filter out "NULL" values from the tags list.
            val tags        = (json \ "tags").asOpt[List[String]].map(tags => tags.filter(tag => tag != "NULL"))
            val valAccuracy = (json \ "validation_estimated_accuracy").as[Double]
            val valResult   = if ((json \ "validation_result").as[String] == "correct") 1 else 2
            val apiVersion  = (json \ "api_version").as[String]

            Some(LabelAi(0, labelData.label.labelId, valResult, valAccuracy, tags, apiVersion, OffsetDateTime.now))
          } else {
            logger.warn(s"AI API for label $labelId returned error status: ${response.status} - ${response.statusText}")
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
   * @return A Future containing the AI validation mission_id
   */
  def getAiValidateMissionId(labelTypeId: Int): Future[Int] =
    cacheApi.getOrElseUpdate[Int](s"getAiValidateMissionId($labelTypeId)")(db.run(missionTable.getAiValidateMissionId(labelTypeId)))
}
