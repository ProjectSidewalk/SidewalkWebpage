package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import models.api.{ApiError, PlaceFiltersForApi, PlaceForApi}
import models.place.PlaceCategory
import org.apache.pekko.stream.scaladsl.Source
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService, PlacesService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * The Places API (v3, #5311): the destinations people need to reach, from OpenStreetMap, as points.
 *
 * @param cc               Custom controller components for handling requests and responses.
 * @param silhouette       Silhouette library for user authentication and authorization.
 * @param configService    Service for fetching configuration parameters.
 * @param shapefileCreator Helper for creating shapefiles.
 * @param placesService    The places refresh and its whole-city cache.
 * @param apiService       The streaming DB reads behind the filtered path.
 * @param ec               Execution context for handling asynchronous operations.
 */
@Singleton
class PlacesApiController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[models.auth.DefaultEnv],
    configService: ConfigService,
    shapefileCreator: ShapefilesCreatorHelper,
    placesService: PlacesService,
    apiService: ApiService
)(implicit ec: ExecutionContext)
    extends BaseApiController(cc) {

  /**
   * Gets places (#5311): one feature per place, as a point, with its category, name, region, and nearest street.
   *
   * An unfiltered request is the whole city, the one read the AccessScore tool makes, served from a cache; any
   * filter reads the table live.
   *
   * @param bbox       Bounding box in format "minLng,minLat,maxLng,maxLat"
   * @param regionId   Optional region ID: places whose point lies in that region
   * @param regionName Optional region name, used only when regionId is absent
   * @param category   Comma-separated category ids to keep, from `place_categories` on `/v3/api/accessScoreConfig`
   *                   (e.g. "school,transit"); every category by default
   * @param filetype   Output format: "geojson" (default), "csv", "shapefile", "geopackage"
   * @param inline     Whether to display the file inline or as an attachment
   */
  def getPlaces(
      bbox: Option[String],
      regionId: Option[Int],
      regionName: Option[String],
      category: Option[String],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    val parsedBbox = parseBBoxString(bbox)
    // Allowlisted rather than merely parsed: the ids are spliced into raw SQL as literals.
    val parsedCategories = parseAllowlistedList(category, PlaceCategory.idSet, "category")

    val firstError: Option[ApiError] = Seq(
      validateBBoxParam(bbox, parsedBbox),
      validateRegionId(regionId),
      parsedCategories.left.toOption
    ).flatten.headOption

    firstError match {
      case Some(error) => Future.successful(badRequest(error))
      case None        =>
        configService.getCityMapParams.flatMap { cityMapParams =>
          val (finalBbox, finalRegionId, finalRegionName) =
            resolveGeoFilters(bbox, parsedBbox, regionId, regionName, cityMapParams)
          val filters = PlaceFiltersForApi(
            bbox = finalBbox,
            regionId = finalRegionId,
            regionName = finalRegionName,
            categories = parsedCategories.toOption.flatten
          )
          val isFullCity: Boolean = bbox.isEmpty && regionId.isEmpty && regionName.isEmpty && category.isEmpty

          val streamFuture: Future[Source[PlaceForApi, _]] =
            if (isFullCity) {
              placesService
                .getFullCityPlaces(DEFAULT_BATCH_SIZE)
                .map(places => Source.fromIterator(() => places.iterator))
            } else {
              Future.successful(apiService.getPlaces(filters, DEFAULT_BATCH_SIZE))
            }

          streamFuture.flatMap { stream =>
            val baseFileName: String = timestampedFilename("places")
            cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

            filetype match {
              case Some("csv") =>
                outputCSV(stream, PlaceForApi.csvHeader, inline, baseFileName + ".csv")
              case Some("shapefile") =>
                outputShapefile(stream, baseFileName, shapefileCreator.createPlacesShapefile, shapefileCreator)
              case Some("geopackage") =>
                outputGeopackage(stream, baseFileName, shapefileCreator.createPlacesGeopackage, inline)
              case _ => // Default to GeoJSON.
                outputGeoJSON(stream, inline, baseFileName + ".geojson")
            }
          }
        }
    }
  }
}
