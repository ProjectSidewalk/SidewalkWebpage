package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import models.api.{
  AccessScoreConfigForApi,
  ApiError,
  IntersectionAccessScoreForApi,
  RegionAccessScoreForApi,
  SpotlightUnit,
  StreetAccessScoreForApi
}
import models.utils.{LatLngBBox, SpatialQueryType}
import org.apache.pekko.stream.scaladsl.Source
import play.api.libs.json.Json
import play.api.mvc.Result
import play.silhouette.api.Silhouette
import service.{
  AccessScoreService,
  AccessScoreSpotlight,
  AccessScoreSpotlightService,
  AccessScores,
  ApiService,
  ConfigService
}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * AccessScoreController handles API endpoints related to access scores for streets, intersections, and regions.
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
    accessScoreSpotlightService: AccessScoreSpotlightService,
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
        // Logged before the still-computing branch too: a `503` a user reports has to be findable in webpage_activity.
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
        streetScores(bbox, regionId, regionName, resolvedBbox).flatMap {
          case None             => Future.successful(scoresStillComputing)
          case Some(allStreets) =>
            // A region's bbox can overlap neighbors, so restrict to the requested region when one was given.
            val streets: Seq[StreetAccessScoreForApi] =
              regionFilterId.fold(allStreets)(id => allStreets.filter(_.regionId == id))
            val baseFileName: String                             = timestampedFilename("accessScoreStreets")
            val streetStream: Source[StreetAccessScoreForApi, _] = Source.fromIterator(() => streets.iterator)

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
                outputGeoJSON(streetStream, inline, baseFileName + ".geojson")
            }
        }
    }
  }

  /**
   * AccessScore for intersections (v3, #5095).
   *
   * Returns each intersection at the end of a street in the queried area, scored from the corner features (curb ramps,
   * missing curb ramps, crosswalks, signals) pooled on it across every street meeting there. Supports the standard v3
   * geo-filters (bbox / regionId / regionName) and output formats (geojson, csv, shapefile, geopackage).
   *
   * @param bbox       Optional bounding box "minLng,minLat,maxLng,maxLat"; intersections inside it are returned.
   * @param regionId   Optional region id (resolved to the region's bbox; intersections are filtered back to it).
   * @param regionName Optional region name (used only when regionId is absent).
   * @param filetype   Output format: "csv", "shapefile", "geopackage", or GeoJSON by default.
   * @param inline     Whether to display the response inline rather than as an attachment.
   */
  def getAccessScoreIntersections(
      bbox: Option[String],
      regionId: Option[Int],
      regionName: Option[String],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    resolveAccessScoreArea(bbox, regionId, regionName).flatMap {
      case Left(error)                           => Future.successful(badRequest(error))
      case Right((resolvedBbox, regionFilterId)) =>
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
        accessScores(bbox, regionId, regionName, resolvedBbox).flatMap {
          case None         => Future.successful(scoresStillComputing)
          case Some(scores) =>
            // The computation scores the ends of every selected street, which can lie past the bbox or in a neighboring
            // region; trim back to what was asked for.
            val intersections: Seq[IntersectionAccessScoreForApi] = (bbox, regionFilterId) match {
              case (Some(_), _) =>
                scores.intersections.filter { i =>
                  i.geometry.getY >= resolvedBbox.minLat && i.geometry.getY <= resolvedBbox.maxLat &&
                  i.geometry.getX >= resolvedBbox.minLng && i.geometry.getX <= resolvedBbox.maxLng
                }
              case (None, Some(id)) => scores.intersections.filter(_.regionId.contains(id))
              case _                => scores.intersections
            }
            val baseFileName: String                             = timestampedFilename("accessScoreIntersections")
            val stream: Source[IntersectionAccessScoreForApi, _] = Source.fromIterator(() => intersections.iterator)

            filetype match {
              case Some("csv") =>
                outputCSV(stream, IntersectionAccessScoreForApi.csvHeader, inline, baseFileName + ".csv")
              case Some("shapefile") =>
                outputShapefile(
                  stream,
                  baseFileName,
                  shapefileCreator.createIntersectionAccessScoreShapefile,
                  shapefileCreator
                )
              case Some("geopackage") =>
                outputGeopackage(
                  stream,
                  baseFileName,
                  shapefileCreator.createIntersectionAccessScoreGeopackage,
                  inline
                )
              case _ =>
                outputGeoJSON(stream, inline, baseFileName + ".geojson")
            }
        }
    }
  }

  /**
   * AccessScore for regions (v3, #3855).
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
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
        val regionScores: Future[Option[Seq[RegionAccessScoreForApi]]] =
          if (isFullCity(bbox, regionId, regionName)) accessScoreService.getFullCityRegionScores(DEFAULT_BATCH_SIZE)
          else accessScoreService.computeRegionScoresV3(resolvedBbox, DEFAULT_BATCH_SIZE).map(Some(_))
        regionScores.flatMap {
          case None             => Future.successful(scoresStillComputing)
          case Some(allRegions) =>
            val regions: Seq[RegionAccessScoreForApi] =
              regionFilterId.fold(allRegions)(id => allRegions.filter(_.regionId == id))
            val baseFileName: String                             = timestampedFilename("accessScoreRegions")
            val regionStream: Source[RegionAccessScoreForApi, _] = Source.fromIterator(() => regions.iterator)

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
                outputGeoJSON(regionStream, inline, baseFileName + ".geojson")
            }
        }
    }
  }

  /**
   * The AccessScore engine's configuration (v3, #3855): scored types, base weights and scoring modes, the rating
   * multipliers, tag adjustments, and the named weight presets, plus `clusters_updated_at`, when the clusters every
   * score is computed from were last rebuilt. With the per-street `severity_counts` and `tag_adjustments` from the
   * streets endpoint, this is everything a client needs to recompute a score under its own weights without
   * re-declaring any of the engine's constants.
   */
  def getAccessScoreConfig = silhouette.UserAwareAction.async { implicit request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
    // The engine's constants plus the one runtime fact a reader of the scores needs: how fresh the clusters are.
    accessScoreService.clustersUpdatedAt.map { updatedAt =>
      Ok(AccessScoreConfigForApi.current.toJson + ("clusters_updated_at" -> Json.toJson(updatedAt)))
    }
  }

  /**
   * The AccessScore Spotlight feed (v3, #5215): the highest- and lowest-scoring neighborhoods or streets.
   *
   * Reads only the nightly `region_access_score` / `street_access_score` tables, so a landing page hit never sets a
   * city's AccessScore recomputing. `scope=cities` fans the same read out over every publicly launched deployment
   * and stamps each row with the city it came from; that scope has no `nearest` list, since its call to action
   * would have to send the visitor to another city's site.
   *
   * JSON only: this is the feed behind a page module, not a data export. The underlying scores are downloadable in
   * every format from `/v3/api/accessScoreRegions` and `/v3/api/accessScoreStreets`.
   *
   * @param unit  Which unit to rank: "regions" (default) or "streets".
   * @param n     How many rows each list holds; defaults to 5 and is capped so one request can't ask for a city.
   * @param scope "cities" for the cross-city ranking; anything else, or absent, is this deployment alone.
   */
  def getAccessScoreSpotlight(unit: Option[String], n: Option[Int], scope: Option[String]) =
    silhouette.UserAwareAction.async { implicit request =>
      val resolvedUnit: String = unit.getOrElse(SpotlightUnit.Regions)
      if (!SpotlightUnit.All.contains(resolvedUnit)) {
        Future.successful(
          badRequest(
            ApiError.invalidParameter(
              s"unit must be one of ${SpotlightUnit.All.mkString(", ")}.",
              "unit"
            )
          )
        )
      } else if (n.exists(value => value < 1 || value > AccessScoreSpotlight.MaxListSize)) {
        Future.successful(
          badRequest(
            ApiError.invalidParameter(s"n must be between 1 and ${AccessScoreSpotlight.MaxListSize}.", "n")
          )
        )
      } else {
        val listSize: Int = n.getOrElse(AccessScoreSpotlight.DefaultListSize)
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
        val spotlight =
          if (scope.contains(AccessScoreApiController.CitiesScope)) {
            accessScoreSpotlightService.getCrossCitySpotlight(resolvedUnit, listSize, request2Messages.lang)
          } else {
            accessScoreSpotlightService.getSpotlight(resolvedUnit, listSize)
          }
        spotlight.map(result => Ok(result.toJson))
      }
    }

  /** Whether a request carries no geo-filter at all, i.e. resolves to the city's configured bounds. */
  private def isFullCity(bbox: Option[String], regionId: Option[Int], regionName: Option[String]): Boolean =
    bbox.isEmpty && regionId.isEmpty && regionName.isEmpty

  /**
   * The street and intersection scores a request needs. An unfiltered request is the whole city, the one computation
   * worth caching; a filter keeps the live path.
   *
   * @return The scores, or `None` when the full-city value is not cached yet and its computation outlasted
   *         [[AccessScoreService.FullCityColdWait]] (#5418). A filtered request is always `Some`.
   */
  private def accessScores(
      bbox: Option[String],
      regionId: Option[Int],
      regionName: Option[String],
      resolvedBbox: LatLngBBox
  ): Future[Option[AccessScores]] =
    if (isFullCity(bbox, regionId, regionName)) accessScoreService.getFullCityScores(DEFAULT_BATCH_SIZE)
    else {
      accessScoreService.computeAccessScoresV3(SpatialQueryType.Street, resolvedBbox, DEFAULT_BATCH_SIZE).map(Some(_))
    }

  private def streetScores(
      bbox: Option[String],
      regionId: Option[Int],
      regionName: Option[String],
      resolvedBbox: LatLngBBox
  ): Future[Option[Seq[StreetAccessScoreForApi]]] =
    accessScores(bbox, regionId, regionName, resolvedBbox).map(_.map(_.streets))

  /**
   * The answer to a full-city request whose scores are still being computed (#5418): a `503` with a `Retry-After`,
   * sent before the reverse proxy's 60-second timeout would have turned the wait into a `502`. The computation keeps
   * running server-side, so a client that honors the header finds a warm cache; the AccessScore tool does. The detail
   * names no cause: the cache is cold after a deploy, but also after the value aged out or a compute failed.
   */
  private def scoresStillComputing: Result =
    ApiError
      .toResult(
        ApiError.stillComputing(
          "This city's AccessScores are still being computed. Retry after the number of seconds in the Retry-After " +
            "header."
        )
      )
      .withHeaders(RETRY_AFTER -> AccessScoreApiController.StillComputingRetryAfterSeconds.toString)

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

object AccessScoreApiController {

  /** The `scope` value that turns the Spotlight into a cross-city ranking. */
  val CitiesScope: String = "cities"

  /**
   * What a `503` for a still-computing full-city score tells the client to wait (#5418). Half of the request's own
   * cold wait, so a client that retries on the header's schedule typically arrives once the computation has landed.
   */
  val StillComputingRetryAfterSeconds: Int = 30
}
