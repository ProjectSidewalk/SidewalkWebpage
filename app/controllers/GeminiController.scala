package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import play.api.libs.json._
import play.api.libs.ws._
import play.api.mvc._
import play.api.{Configuration, Logger}

import java.util.Base64
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

/**
 * Controller for handling API requests for the Gemini 2.0 Flash model, sending GSV screenshots for visual analysis.
 */
@Singleton
class GeminiController @Inject() (
    cc: CustomControllerComponents,
    ws: WSClient,
    config: Configuration,
    configService: service.ConfigService,
    gsvDataService: service.GsvDataService
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {
  private val logger = Logger(this.getClass)

  // Retrieve API key from configuration.
  private val geminiApiKey: Option[String] = config.getOptional[String]("gemini-api-key")
  private val geminiApiUrl: Option[String] = geminiApiKey.map { key =>
    s"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=$key"
  }

  private def generatePrompt(wayType: String, cityName: String): String = {
    s"""You are an expert in pedestrian accessibility assessment. Analyze these images from a street in $cityName, making use of the OSM way_type: $wayType, and provide guidance for auditing this street using Project Sidewalk.
       |
       |Project Sidewalk labels: Curb Ramp, Missing Curb Ramp, Obstacle, Surface Problem, No Sidewalk.
       |
       |Key context-specific guidance:
       |- For pedestrian-only or narrow local roads: Treat the road surface as sidewalk; don't add No Sidewalk/Curb Ramp labels, label road surface issues as if they were issues with the sidewalk
       |- If you see sidewalks in the image, tell users to label them accordingly
       |- If there are no sidewalks, then there is no need for curb ramps, so you don't need to even mention curbs or curb ramps to them
       |- If there are no sidewalks, users should only add Obstacle labels for dangerous obstacles that would make it difficult to get past
       |- Note that in India, sidewalks may not be very high quality, and may be made of brick
       |
       |Use the images to figure out which contexts above apply, and provide guidance accordingly.
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
    val wayType      = (request.body \ "way_type").as[String]
    val streetEdgeId = (request.body \ "street_edge_id").as[Int]
    val cityName     = configService.getCityName(request.lang)

    // Create the prompt using the way type and city name.
    val prompt = generatePrompt(wayType, cityName)

    for {
      gsvImageUrls   <- gsvDataService.getImageUrlsForStreet(streetEdgeId) // Get GSV image URLs for the street
      imageObjects   <- fetchAndEncodeImages(gsvImageUrls)                 // Fetch and encode images
      geminiResponse <- sendToGeminiApi(prompt, imageObjects)              // Send to Gemini API
    } yield {
      val activity = s"Analyzing street $streetEdgeId with URLs: ${gsvImageUrls.mkString(", ")}"
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, activity)
      geminiResponse
    }
  }

  /**
   * Fetches images from Google Street View URLs and converts them to base64 encoded objects.
   * @param imageUrls Sequence of GSV image URLs
   * @return Future sequence of JSON objects containing base64 encoded image data
   */
  private def fetchAndEncodeImages(imageUrls: Seq[String]): Future[Seq[JsObject]] = {
    if (imageUrls.isEmpty) {
      Future.successful(Seq.empty[JsObject])
    } else {
      val imageFutures: Seq[Future[Option[JsObject]]] = imageUrls.map { url =>
        ws.url(url)
          .get()
          .map { gsvResponse =>
            if (gsvResponse.status == 200) {
              // Convert image bytes to base64.
              val imageBytes: Array[Byte] = gsvResponse.bodyAsBytes.toArray
              val base64Data: String      = Base64.getEncoder.encodeToString(imageBytes)
              Some(
                Json.obj(
                  "inline_data" -> Json.obj(
                    "mime_type" -> "image/jpeg",
                    "data"      -> base64Data
                  )
                )
              )
            } else {
              None
            }
          }
          .recover { case ex: Exception =>
            // Log error but don't fail the entire request.
            logger.warn(s"Failed to fetch GSV image from $url: ${ex.getMessage}")
            None
          }
      }

      Future.sequence(imageFutures).map(_.flatten)
    }
  }

  /**
   * Sends the prompt and images to Gemini API for analysis.
   * @param prompt The text prompt for analysis
   * @param imageObjects Sequence of base64 encoded image objects
   * @return Future Result containing the API response
   */
  private def sendToGeminiApi(prompt: String, imageObjects: Seq[JsObject]): Future[Result] = {
    if (imageObjects.isEmpty) {
      Future.successful(
        BadRequest(
          Json.obj(
            "success" -> false,
            "error"   -> "No valid images could be fetched for analysis"
          )
        )
      )
    } else {
      // Construct parts array with prompt and images.
      val promptPart = Json.obj("text" -> prompt)
      val imageParts = JsArray(imageObjects)
      val allParts   = Json.arr(promptPart) ++ imageParts

      // Build Gemini API payload
      val geminiPayload = Json.obj(
        "contents" -> Json.arr(
          Json.obj("parts" -> allParts)
        ),
        "generationConfig" -> Json.obj(
          "temperature"     -> 0.7,
          "maxOutputTokens" -> 2048
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
              "error"   -> s"Gemini API request failed: ${ex.getMessage}"
            )
          )
        }
    }
  }
}
