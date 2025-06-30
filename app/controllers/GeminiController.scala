package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import play.api.Configuration
import play.api.libs.json._
import play.api.libs.ws._
import play.api.mvc._

import javax.inject._
import scala.concurrent.ExecutionContext

/**
 * Controller for handling Gemini Vision API requests.
 * Processes canvas screenshots and sends them to Google's Gemini 2.0 Flash model
 * for visual analysis.
 */
@Singleton
class GeminiController @Inject() (
    cc: CustomControllerComponents,
    ws: WSClient,
    config: Configuration,
    configService: service.ConfigService
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {

  // Retrieve API key from configuration.
  private val geminiApiKey: Option[String] = config.getOptional[String]("gemini-api-key")
  private val geminiApiUrl: Option[String] = geminiApiKey.map { key =>
    s"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=$key"
  }

  private def generatePrompt(wayType: String, cityName: String): String = {
    s"""You are an expert in pedestrian accessibility assessment. Analyze this street scene from $cityName, making use of the OSM way_type: $wayType, and provide guidance for auditing this street using Project Sidewalk.
       |
       |Project Sidewalk labels: Curb Ramp, Missing Curb Ramp, Obstacle, Surface Problem, No Sidewalk.
       |
       |Key context-specific guidance:
       |- Pedestrian-only roads: Treat the road surface as sidewalk; don't add No Sidewalk/Curb Ramp labels
       |- Narrow local roads: Expect pedestrians to walk on roadway; label road surface issues as if they were issues with the sidewalk
       |- Main roads: Expect dedicated sidewalks; add No Sidewalk labels when absent
       |- Focus on deviations from standard US pedestrian infrastructure
       |- If there are no sidewalks, then there are no need for curb ramps, so you don't need to even mention curbs or curb ramps to them
       |- If there are no sidewalks, users should only add Obstacle labels for dangerous obstacles that would make it difficult to get past
       |
       |Your response should be practical, actionable guidance in exactly 2 lines.""".stripMargin
  }

  /**
   * Analyzes a canvas screenshot using Gemini Vision API. Expects JSON payload with base64 image data and text prompt.
   *
   * @return JSON response containing the analysis result
   */
  def analyzeImage(): Action[JsValue] = cc.securityService.SecuredAction(parse.json) { implicit request =>
    // Extract image data and prompt from request.
    val imageDataUrl = (request.body \ "image").as[String]
    val wayType      = (request.body \ "way_type").as[String]
    val cityName     = configService.getCityName(request.lang)

    // Create the prompt using the way type and city name.
    val prompt = generatePrompt(wayType, cityName)

    // Remove data URL prefix to get base64 data.
    val base64Data = imageDataUrl.split(",")(1)

    // Construct request payload for Gemini API.
    val geminiPayload = Json.obj(
      "contents" -> Json.arr(
        Json.obj(
          "parts" -> Json.arr(
            Json.obj("text" -> prompt),
            Json.obj(
              "inline_data" -> Json.obj(
                "mime_type" -> "image/jpeg",
                "data"      -> base64Data
              )
            )
          )
        )
      ),
      "generationConfig" -> Json.obj(
        "temperature"     -> 0.7,
        "maxOutputTokens" -> 1000
      )
    )

    // Send request to Gemini API.
    ws.url(geminiApiUrl.getOrElse(""))
      .withHttpHeaders("Content-Type" -> "application/json")
      .post(geminiPayload)
      .map { response =>
        if (response.status == 200) {
          // Extract text response from Gemini API response.
          val responseText = (((response.json \ "candidates")(0) \ "content" \ "parts")(0) \ "text").as[String]
          Ok(Json.obj("success" -> true, "response" -> responseText))
        } else {
          BadRequest(
            Json.obj(
              "success" -> false,
              "error"   -> s"Gemini API error: ${response.status} - ${response.body}"
            )
          )
        }
      }
      .recover { case ex: Exception =>
        InternalServerError(
          Json.obj(
            "success" -> false,
            "error"   -> s"Request failed: ${ex.getMessage}"
          )
        )
      }
  }
}
