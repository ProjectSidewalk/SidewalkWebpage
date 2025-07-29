package service

import com.google.inject.ImplementedBy
import models.label.{LabelAi, LabelDataForAi, LabelPointTable, LabelTypeEnum}
import models.user.SidewalkUserTable
import models.utils._
import models.validation.LabelValidation
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.JsValue
import play.api.libs.ws.WSClient
import play.api.{Configuration, Logger}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[AiServiceImpl])
trait AiService {
  def validateLabelsWithAi(labelIds: Seq[Int]): Future[Seq[Option[LabelAi]]]
}

@Singleton
class AiServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    ws: WSClient,
    labelTable: models.label.LabelTable,
    validationService: ValidationService,
    labelAiTable: models.label.LabelAiTable
)(implicit val ec: ExecutionContext)
    extends AiService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val logger                         = Logger(this.getClass)
  private val cityId: String                 = config.get[String]("city-id")
  private val AI_VALIDATIONS_ON: Boolean     = config.get[Boolean](s"city-params.ai-validation-enabled.$cityId")
  private val AI_TAG_SUGGESTIONS_ON: Boolean = config.get[Boolean](s"city-params.ai-tag-suggestions-enabled.$cityId")
  private val AI_VALIDATION_MIN_ACCURACY: Double = config.get[Double](s"city-params.ai-validation-min-accuracy.$cityId")

  def validateLabelsWithAi(labelIds: Seq[Int]): Future[Seq[Option[LabelAi]]] = {
    if (AI_VALIDATIONS_ON || AI_TAG_SUGGESTIONS_ON) {
      val startTime = OffsetDateTime.now
      Future.sequence {
        labelIds.map { labelId =>
          // Fetch label metadata from the database.
          val labelMetadataFuture: Future[Option[LabelDataForAi]] = db.run(labelTable.getLabelDataForAi(labelId))

          labelMetadataFuture
            .flatMap {
              case Some(labelData) =>
                // Call the AI API to process the panorama data and validate labels.
                callAIAPI(labelData).map(_.map(aiResults => (aiResults, labelData)))
              case None =>
                logger.warn(s"Info for label with ID $labelId not found.")
                Future.failed(new Exception(s"Label with ID $labelId not found."))
            }
            .map(_.map { case (aiResults, labelData) =>
              println(aiResults)
              val aiValidation: Option[Int] =
                if (aiResults.validationAccuracy >= AI_VALIDATION_MIN_ACCURACY) Some(aiResults.validationResult)
                else None

              // If AI validations are enabled and confidence is above the threshold, submit a validation.
              if (AI_VALIDATIONS_ON && aiValidation.isDefined) {
                val label      = labelData.label
                val labelPoint = labelData.labelPoint
                val validation = LabelValidation(
                  0, labelId, aiValidation.get, label.severity, label.severity, label.tags, label.tags,
                  SidewalkUserTable.aiUserId, label.missionId, Some(labelPoint.canvasX), Some(labelPoint.canvasY),
                  labelPoint.heading, labelPoint.pitch, labelPoint.zoom.toFloat, LabelPointTable.canvasWidth,
                  LabelPointTable.canvasHeight, startTime, aiResults.timeCreated, "SidewalkAI"
                )
                // TODO Need to check if this is a redone validation.
                validationService.submitValidations(
                  Seq(ValidationSubmission(validation, comment = None, undone = false, redone = false))
                )
              }

              // Add AI information to the label_ai table.
              db.run(labelAiTable.save(aiResults))
              aiResults
            })
        }
      }
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
  private def callAIAPI(labelData: LabelDataForAi): Future[Option[LabelAi]] = {
    val SIDEWALK_AI_API_HOSTNAME: String = config.get[String]("sidewalk-ai-api-hostname")
    val url: String                      = s"https://${SIDEWALK_AI_API_HOSTNAME}/process"

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
            logger.warn(s"AI API returned error status: ${response.status} - ${response.statusText}")
            None
          }
        } catch {
          case e: Exception =>
            logger.warn(s"Failed to parse AI API response: ${e.getMessage}")
            None
        }
      }
      .recover { case e: Exception =>
        logger.warn(s"AI API request failed: ${e.getMessage}")
        None
      }
  }
}
