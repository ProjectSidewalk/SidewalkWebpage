package controllers.api

import controllers.base.CustomControllerComponents
import org.apache.pekko.stream.Materializer
import play.api.Configuration
import play.api.Logger
import play.api.i18n.Lang
import play.api.libs.json.{JsObject, Json}
import play.silhouette.api.Silhouette
import service.ConfigService

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * Controller for handling API endpoints related to cities in Project Sidewalk.
 *
 * This controller provides information about all cities where Project Sidewalk is deployed,
 * including their geographic information, visibility status, and basic metadata. It's designed
 * to help clients discover available Project Sidewalk locations and their boundaries.
 *
 * @param cc Custom controller components for handling requests and responses
 * @param silhouette Silhouette library for user authentication and authorization
 * @param configService Service for fetching configuration parameters
 * @param config Configuration object for accessing application settings
 * @param ec Execution context for handling asynchronous operations
 * @param mat Materializer for handling Akka streams
 */
@Singleton
class CitiesApiController @Inject()(
  cc: CustomControllerComponents,
  val silhouette: Silhouette[models.auth.DefaultEnv],
  configService: ConfigService,
  config: Configuration
)(implicit ec: ExecutionContext, mat: Materializer) extends BaseApiController(cc) {

  // Logger for this class
  private val logger = Logger(this.getClass)

  /**
   * Returns information about all cities where Project Sidewalk is deployed.
   *
   * This endpoint provides details about each city including:
   * - City ID and country
   * - City names (short and formatted)
   * - URL for the city's Project Sidewalk site
   * - Visibility status (public, private, etc.)
   * - Geographic center coordinates
   * - Zoom level
   * - Geographic boundaries (north, south, east, west)
   *
   * The response includes basic information for all cities, but geographic information
   * may be omitted for some cities if it cannot be retrieved from the database.
   *
   * @return JSON response containing city information
   */
  def getCities = silhouette.UserAwareAction.async { implicit request =>
    // Get city information from ConfigService
    val cityInfosFuture = configService.getCommonPageData(request.lang).map { pageData =>
      pageData.allCityInfo
    }

    // Build cities information with map parameters
    cityInfosFuture.flatMap { cityInfos =>
      // Get map parameters for each city - use parallel execution for efficiency
      val cityDetailsWithMapParams = Future.sequence(
        cityInfos.map { cityInfo =>
          // Retrieve map parameters for this city from its database schema
          configService.getCityMapParamsBySchema(cityInfo.cityId).map { mapParamsOpt =>
            buildCityObject(cityInfo, mapParamsOpt, request.lang)
          }
        }
      )

      cityDetailsWithMapParams.map { cityDetails =>
        // Log the API request for auditing
        cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)
        
        // Return JSON response
        Ok(Json.obj(
          "status" -> "OK",
          "cities" -> cityDetails
        ))
      }
    }.recover {
      case e: Exception =>
        // Log the error for diagnostic purposes
        logger.error(s"Failed to retrieve city information: ${e.getMessage}", e)
        
        // Return error response to client
        InternalServerError(Json.obj(
          "status" -> 500,
          "code" -> "INTERNAL_SERVER_ERROR",
          "message" -> s"Failed to retrieve city information: ${e.getMessage}"
        ))
    }
  }

  /**
   * Builds a JSON object containing information about a city.
   *
   * This private helper method constructs a JSON object with city details.
   * If map parameters are available, it includes geographic information such as
   * center coordinates and boundaries. If not, it returns basic city information only.
   *
   * @param cityInfo Basic city information from ConfigService
   * @param mapParamsOpt Optional map parameters for the city from the database
   * @param lang Language for localization
   * @return JSON object with city details
   */
  private def buildCityObject(
    cityInfo: service.CityInfo, 
    mapParamsOpt: Option[models.utils.MapParams], 
    lang: Lang
  ): JsObject = {
    // Build base city information object
    val baseInfo = Json.obj(
      "cityId" -> cityInfo.cityId,
      "countryId" -> cityInfo.countryId,
      "cityNameShort" -> cityInfo.cityNameShort,
      "cityNameFormatted" -> cityInfo.cityNameFormatted,
      "url" -> cityInfo.URL,
      "visibility" -> cityInfo.visibility
    )

    // Add map coordinates only if available
    mapParamsOpt.map { mapParams =>
      // Calculate boundary coordinates based on map parameters
      val north = Math.max(mapParams.lat1, mapParams.lat2)
      val south = Math.min(mapParams.lat1, mapParams.lat2)
      val east = Math.max(mapParams.lng1, mapParams.lng2)
      val west = Math.min(mapParams.lng1, mapParams.lng2)
      
      // Combine base info with geographic information
      baseInfo ++ Json.obj(
        "centerLat" -> mapParams.centerLat,
        "centerLng" -> mapParams.centerLng,
        "zoom" -> mapParams.zoom,
        "bounds" -> Json.obj(
          "north" -> north,
          "south" -> south,
          "east" -> east,
          "west" -> west
        )
      )
    }.getOrElse {
      // If no map parameters are available, log warning and return base info only
      logger.warn(s"No map parameters available for city ${cityInfo.cityId}")
      baseInfo
    }
  }
}