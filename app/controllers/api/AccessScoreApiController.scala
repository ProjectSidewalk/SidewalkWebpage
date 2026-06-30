package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import models.api.{ApiError, RegionAccessScoreForApi, StreetAccessScoreForApi}
import models.utils.{LatLngBBox, SpatialQueryType}
import org.apache.pekko.stream.scaladsl.Source
import play.silhouette.api.Silhouette
import service.{AccessScoreService, ApiService, ConfigService}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * AccessScoreController handles API endpoints related to access scores for streets and neighborhoods.
 * It provides functionality to compute and return access scores in various formats such as CSV, shapefile, or GeoJSON.
 *
 * @constructor Creates an instance of AccessScoreController with necessary dependencies.
 * @param cc Custom controller components for handling requests and responses.
 * @param silhouette Silhouette library for user authentication and authorization.
 * @param configService Service for fetching configuration parameters.
 * @param shapefileCreator Helper for creating shapefiles.
 * @param accessScoreService Service for computing access scores.
 * @param ec Execution context for handling asynchronous operations.
 */
@Singleton
class AccessScoreApiController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[models.auth.DefaultEnv],
    configService: ConfigService,
    shapefileCreator: ShapefilesCreatorHelper,
    accessScoreService: AccessScoreService,
    apiService: ApiService
)(implicit ec: ExecutionContext)
    extends BaseApiController(cc) {

  /**
   * AccessScore for streets (v3, #3855).
   *
   * Returns the severity/quality- and tag-aware AccessScore for each street in the queried area. Supports the standard
   * v3 geo-filters (bbox / regionId / regionName) and output formats (geojson, csv, shapefile, geopackage).
   *
   * @param bbox       Optional bounding box "minLng,minLat,maxLng,maxLat".
   * @param regionId   Optional region id to score (resolved to the region's bbox; streets are filtered back to it).
   * @param regionName Optional region name (used only when regionId is absent).
   * @param filetype   Output format: "csv", "shapefile", "geopackage", or GeoJSON by default.
   * @param inline     Whether to display the response inline rather than as an attachment.
   */
  def getAccessScoreStreets(
      bbox: Option[String],
      regionId: Option[Int],
      regionName: Option[String],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    resolveAccessScoreArea(bbox, regionId, regionName).flatMap {
      case Left(error)                           => Future.successful(badRequest(error))
      case Right((resolvedBbox, regionFilterId)) =>
        accessScoreService.computeStreetScoresV3(SpatialQueryType.Street, resolvedBbox, DEFAULT_BATCH_SIZE).flatMap {
          allStreets =>
            // A region's bbox can overlap neighbors, so restrict to the requested region when one was given.
            val streets: Seq[StreetAccessScoreForApi] =
              regionFilterId.fold(allStreets)(id => allStreets.filter(_.regionId == id))
            val baseFileName: String                             = s"accessScoreStreets_${OffsetDateTime.now()}"
            val streetStream: Source[StreetAccessScoreForApi, _] = Source.fromIterator(() => streets.iterator)
            cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

            filetype match {
              case Some("csv") =>
                outputCSV(streetStream, StreetAccessScoreForApi.csvHeader, inline, baseFileName + ".csv")
              case Some("shapefile") =>
                outputShapefile(
                  streetStream,
                  baseFileName,
                  shapefileCreator.createStreetAccessScoreShapefile,
                  shapefileCreator
                )
              case Some("geopackage") =>
                outputGeopackage(streetStream, baseFileName, shapefileCreator.createStreetAccessScoreGeopackage, inline)
              case _ =>
                outputGeoJSON(streetStream, inline, baseFileName + ".json")
            }
        }
    }
  }

  /**
   * AccessScore for regions/neighborhoods (v3, #3855).
   *
   * Returns each region's street-length-weighted AccessScore plus audit coverage. Supports the standard v3 geo-filters
   * (bbox / regionId / regionName) and output formats (geojson, csv, shapefile, geopackage).
   *
   * @param bbox       Optional bounding box "minLng,minLat,maxLng,maxLat".
   * @param regionId   Optional region id to score (resolved to the region's bbox; results are filtered back to it).
   * @param regionName Optional region name (used only when regionId is absent).
   * @param filetype   Output format: "csv", "shapefile", "geopackage", or GeoJSON by default.
   * @param inline     Whether to display the response inline rather than as an attachment.
   */
  def getAccessScoreRegions(
      bbox: Option[String],
      regionId: Option[Int],
      regionName: Option[String],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    resolveAccessScoreArea(bbox, regionId, regionName).flatMap {
      case Left(error)                           => Future.successful(badRequest(error))
      case Right((resolvedBbox, regionFilterId)) =>
        accessScoreService.computeRegionScoresV3(resolvedBbox, DEFAULT_BATCH_SIZE).flatMap { allRegions =>
          val regions: Seq[RegionAccessScoreForApi] =
            regionFilterId.fold(allRegions)(id => allRegions.filter(_.regionId == id))
          val baseFileName: String                             = s"accessScoreRegions_${OffsetDateTime.now()}"
          val regionStream: Source[RegionAccessScoreForApi, _] = Source.fromIterator(() => regions.iterator)
          cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

          filetype match {
            case Some("csv") =>
              outputCSV(regionStream, RegionAccessScoreForApi.csvHeader, inline, baseFileName + ".csv")
            case Some("shapefile") =>
              outputShapefile(
                regionStream,
                baseFileName,
                shapefileCreator.createRegionAccessScoreShapefile,
                shapefileCreator
              )
            case Some("geopackage") =>
              outputGeopackage(regionStream, baseFileName, shapefileCreator.createRegionAccessScoreGeopackage, inline)
            case _ =>
              outputGeoJSON(regionStream, inline, baseFileName + ".json")
          }
        }
    }
  }

  /**
   * Resolves the v3 geo-filters to a single bounding box to score within, plus the region id to post-filter results by.
   *
   * AccessScore is computed over a bbox, so a region filter is resolved to that region's bounding box; the region id is
   * retained so the (rectangular) bbox can be trimmed back to the region. Applies the standard v3 precedence via
   * `resolveGeoFilters`, and reports an unknown region id/name as a 400.
   *
   * @return `Right((bbox, regionIdToPostFilterBy))`, or `Left(ApiError)` for an invalid or unknown parameter.
   */
  private def resolveAccessScoreArea(
      bbox: Option[String],
      regionId: Option[Int],
      regionName: Option[String]
  ): Future[Either[ApiError, (LatLngBBox, Option[Int])]] = {
    val parsedBbox: Option[LatLngBBox] = parseBBoxString(bbox)
    val firstError: Option[ApiError]   =
      Seq(validateBBoxParam(bbox, parsedBbox), validateRegionId(regionId)).flatten.headOption

    firstError match {
      case Some(error) => Future.successful(Left(error))
      case None        =>
        configService.getCityMapParams.flatMap { cityMapParams =>
          val (finalBbox, finalRegionId, finalRegionName) =
            resolveGeoFilters(bbox, parsedBbox, regionId, regionName, cityMapParams)
          (finalBbox, finalRegionId, finalRegionName) match {
            case (Some(resolvedBbox), _, _) =>
              Future.successful(Right((resolvedBbox, None)))
            case (None, Some(id), _) =>
              apiService.getRegionBBox(id).map {
                case Some(regionBbox) => Right((regionBbox, Some(id)))
                case None => Left(ApiError.invalidParameter(s"No region found with regionId $id.", "regionId"))
              }
            case (None, None, Some(name)) =>
              apiService.resolveRegionByName(name).map {
                case Some((id, regionBbox)) => Right((regionBbox, Some(id)))
                case None => Left(ApiError.invalidParameter(s"No region found with regionName '$name'.", "regionName"))
              }
            case _ =>
              // resolveGeoFilters always yields a default bbox when no filter is supplied, so this is unreachable.
              Future.successful(Left(ApiError.invalidParameter("A bbox or region filter is required.", "bbox")))
          }
        }
    }
  }
}
