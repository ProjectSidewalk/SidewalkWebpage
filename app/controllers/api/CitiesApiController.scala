package controllers.api

import controllers.base.CustomControllerComponents
import play.api.Logger
import play.api.libs.json.{JsNumber, JsObject, JsString, Json}
import play.silhouette.api.Silhouette
import service.{CityInfo, ConfigService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * Controller for handling API endpoints related to cities in Project Sidewalk.
 *
 * This controller provides information about all cities where Project Sidewalk is deployed, including their geographic
 * information, visibility status, and basic metadata. It supports multiple output formats (JSON, CSV, GeoJSON) to
 * accommodate different client needs.
 *
 * JSON format is suitable for general use, CSV for data analysis in spreadsheets, and GeoJSON for mapping applications.
 *
 * @param cc Custom controller components for handling requests and responses.
 * @param silhouette Silhouette library for user authentication and authorization.
 * @param configService Service for fetching configuration parameters.
 * @param ec Execution context for handling asynchronous operations.
 */
@Singleton
class CitiesApiController @Inject()(
  cc: CustomControllerComponents,
  val silhouette: Silhouette[models.auth.DefaultEnv],
  configService: ConfigService
)(implicit ec: ExecutionContext) extends BaseApiController(cc) {

  private val logger = Logger("application")

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
   * The response includes basic information for all cities, but geographic information may be omitted for some cities
   * if it cannot be retrieved from the database.
   *
   * The endpoint supports three output formats controlled by the 'filetype' parameter:
   * - JSON (default): Standard JSON object with city data
   * - CSV: Comma-separated values for use in spreadsheets
   * - GeoJSON: Geographic JSON format for mapping applications
   *
   * @return Response in requested format containing city information.
   */
  def getCities = silhouette.UserAwareAction.async { implicit request =>
    // Get filetype parameter from request, defaulting to JSON.
    val filetype: String = request.getQueryString("filetype").getOrElse("json").toLowerCase

    // Get city information from ConfigService.
    val cityInfos: Seq[CityInfo] = configService.getAllCityInfo(request.lang)

    // Get map parameters for each city - use parallel execution for efficiency.
    val cityDetailsWithMapParams: Future[Seq[JsObject]] = Future.sequence(
      cityInfos.map { cityInfo =>
        // Retrieve map parameters for this city from its database schema.
        configService.getCityMapParamsBySchema(cityInfo.cityId).map { mapParamsOpt =>
          buildCityObject(cityInfo, mapParamsOpt)
        }
      }
    )

    cityDetailsWithMapParams.map { cityDetails =>
      // Log the API request.
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Return response in the requested format.
      filetype match {
        case "csv" =>
          Ok(generateCsv(cityDetails))
            .withHeaders(
              "Content-Type" -> "text/csv",
              "Content-Disposition" -> "attachment; filename=cities.csv"
            )
        case "geojson" =>
          Ok(generateGeoJson(cityDetails))
            .withHeaders(
              "Content-Type" -> "application/geo+json",
              "Content-Disposition" -> "attachment; filename=cities.geojson"
            )
        case _ => // Default to JSON
          Ok(Json.obj("status" -> "OK", "cities" -> cityDetails))
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
   * This private helper method constructs a JSON object with city details. If map parameters are available, it includes
   * geographic information such as center coordinates and boundaries. If not, it returns basic city information only.
   *
   * @param cityInfo Basic city information from ConfigService.
   * @param mapParamsOpt Optional map parameters for the city from the database.
   * @return JSON object with city details.
   */
  private def buildCityObject(cityInfo: service.CityInfo, mapParamsOpt: Option[models.utils.MapParams]): JsObject = {
    // Build base city information object
    val baseInfo = Json.obj(
      "cityId" -> cityInfo.cityId,
      "countryId" -> cityInfo.countryId,
      "cityNameShort" -> cityInfo.cityNameShort,
      "cityNameFormatted" -> cityInfo.cityNameFormatted,
      "url" -> cityInfo.URL,
      "visibility" -> cityInfo.visibility
    )

    // Add map coordinates only if available.
    mapParamsOpt.map { mapParams =>
      // Calculate boundary coordinates based on map parameters.
      val north = Math.max(mapParams.lat1, mapParams.lat2)
      val south = Math.min(mapParams.lat1, mapParams.lat2)
      val east = Math.max(mapParams.lng1, mapParams.lng2)
      val west = Math.min(mapParams.lng1, mapParams.lng2)

      // Combine base info with geographic information.
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

  /**
   * Converts city data to CSV format.
   *
   * This method generates a CSV string with headers matching the JSON fields, including geographic information where
   * available. It follows CSV best practices including proper escaping of special chars and handling of nested fields.
   *
   * The CSV includes all fields from JSON format, with empty values for fields that aren't available for a given city.
   *
   * @param cityDetails Sequence of city data as JSON objects.
   * @return CSV formatted string with headers.
   */
  private def generateCsv(cityDetails: Seq[JsObject]): String = {
    // Define CSV headers based on all possible fields.
    val headers = Seq(
      "cityId", "countryId", "cityNameShort", "cityNameFormatted", "url", "visibility", "centerLat", "centerLng",
      "zoom", "bounds.north", "bounds.south", "bounds.east", "bounds.west"
    )

    // Generate CSV rows for each city.
    val headerRow: String = headers.mkString(",")
    val cityRows = cityDetails.map { cityObject =>
      // Extract values for each header field, using empty string for missing values.
      headers.map { header =>
        if (header.contains(".")) {
          // Handle nested bounds fields.
          val parts = header.split("\\.")
          val boundsObj = (cityObject \ parts(0)).asOpt[JsObject]
          val value = boundsObj.flatMap(obj => (obj \ parts(1)).asOpt[Double]).map(_.toString).getOrElse("")
          escapeForCsv(value)
        } else {
          // Handle top-level fields.
          val value = (cityObject \ header).toOption match {
            case Some(x: JsString) => x.value
            case Some(x: JsNumber) => x.value.toString
            case _ => ""
          }
          escapeForCsv(value)
        }
      }.mkString(",")
    }

    // Combine header and rows into final CSV.
    (headerRow +: cityRows).mkString("\n")
  }

  /**
   * Escapes a string for CSV output.
   *
   * This method applies standard CSV escaping rules:
   * - If the value contains commas, quotes, or newlines, wrap in quotes.
   * - Escape any double quotes by doubling them.
   *
   * @param value The string value to escape.
   * @return The escaped string.
   */
  private def escapeForCsv(value: String): String = {
    // If value contains commas, quotes, or newlines, wrap in quotes and escape internal quotes.
    if (value.contains(",") || value.contains("\"") || value.contains("\n")) {
      "\"" + value.replace("\"", "\"\"") + "\""
    } else {
      value
    }
  }

  /**
   * Converts city data to GeoJSON format.
   *
   * This method creates a GeoJSON FeatureCollection containing Points for each city with geographic information. Cities
   * without coordinates are omitted from the GeoJSON output.
   *
   * The resulting GeoJSON follows the standard specification with:
   * - Point geometries using [longitude, latitude] coordinate order.
   * - All city properties included in the 'properties' object.
   * - Standard FeatureCollection wrapper.
   *
   * @param cityDetails Sequence of city data as JSON objects.
   * @return GeoJSON formatted object.
   */
  private def generateGeoJson(cityDetails: Seq[JsObject]): JsObject = {
    // Filter cities that have geographic coordinates.
    val features = cityDetails.flatMap { cityObject =>
      // Extract center coordinates.
      val centerLat = (cityObject \ "centerLat").asOpt[Double]
      val centerLng = (cityObject \ "centerLng").asOpt[Double]

      // Only include cities with coordinates.
      (centerLat, centerLng) match {
        case (Some(lat), Some(lng)) =>
          // Create GeoJSON Feature for this city.
          Some(Json.obj(
            "type" -> "Feature",
            "geometry" -> Json.obj(
              "type" -> "Point",
              "coordinates" -> Json.arr(lng, lat) // GeoJSON uses [longitude, latitude] order.
            ),
            "properties" -> cityObject // Include all city properties.
          ))
        case _ => None // Skip cities without coordinates.
      }
    }

    // Create GeoJSON FeatureCollection.
    Json.obj(
      "type" -> "FeatureCollection",
      "features" -> features
    )
  }
}
