package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import models.computation.{RegionScore, StreetScore}
import models.utils.{LatLngBBox, MapParams, SpatialQueryType}
import org.apache.pekko.stream.scaladsl.Source
import play.silhouette.api.Silhouette
import service.{AccessScoreService, ConfigService}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

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
    accessScoreService: AccessScoreService
)(implicit ec: ExecutionContext)
    extends BaseApiController(cc) {

  /**
   * AccessScore:Street V2 (using new clustering methods).
   *
   * @param lat1 First latitude value for the bounding box.
   * @param lng1 First longitude value for the bounding box.
   * @param lat2 Second latitude value for the bounding box.
   * @param lng2 Second longitude value for the bounding box.
   * @param filetype One of "csv", "shapefile", or "geojson".
   * @return The access score for the given neighborhood.
   */
  def getAccessScoreStreetsV2(
      lat1: Option[Double],
      lng1: Option[Double],
      lat2: Option[Double],
      lng2: Option[Double],
      filetype: Option[String]
  ) = silhouette.UserAwareAction.async { implicit request =>
    (for {
      cityMapParams: MapParams <- configService.getCityMapParams
      bbox: LatLngBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)

      // Use the AccessScoreService for computations.
      streetAccessScores: Seq[StreetScore] <-
        accessScoreService.computeStreetScore(SpatialQueryType.Street, bbox, DEFAULT_BATCH_SIZE)
    } yield {
      val baseFileName: String                  = s"accessScoreStreet_${OffsetDateTime.now()}"
      val streetsStream: Source[StreetScore, _] = Source.fromIterator(() => streetAccessScores.iterator)
      cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

      // Output data in the appropriate file format.
      filetype match {
        case Some("csv") =>
          outputCSV(streetsStream, StreetScore.csvHeader, inline = None, baseFileName + ".csv")
        case Some("shapefile") =>
          outputShapefile(streetsStream, baseFileName, shapefileCreator.createStreetShapefile, shapefileCreator)
        case _ =>
          outputGeoJSON(streetsStream, inline = Some(true), filename = baseFileName + ".json")
      }
    }).flatMap(identity) // Flatten the Future[Result] to return a Future[Result].
  }

  /**
   * @param lat1 First latitude value for the bounding box
   * @param lng1 First longitude value for the bounding box
   * @param lat2 Second latitude value for the bounding box
   * @param lng2 Second longitude value for the bounding box
   * @param filetype One of "csv", "shapefile", or "geojson"
   */
  def getAccessScoreNeighborhoodsV2(
      lat1: Option[Double],
      lng1: Option[Double],
      lat2: Option[Double],
      lng2: Option[Double],
      filetype: Option[String]
  ) = silhouette.UserAwareAction.async { implicit request =>
    (for {
      cityMapParams: MapParams <- configService.getCityMapParams
      bbox: LatLngBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)

      // Use the AccessScoreService for computations.
      neighborhoodAccessScores: Seq[RegionScore] <- accessScoreService.computeRegionScore(bbox, DEFAULT_BATCH_SIZE)
    } yield {
      val baseFileName: String                 = s"accessScoreNeighborhood_${OffsetDateTime.now()}"
      val regionStream: Source[RegionScore, _] = Source.fromIterator(() => neighborhoodAccessScores.iterator)
      cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

      // Output data in the appropriate file format.
      filetype match {
        case Some("csv") =>
          outputCSV(regionStream, RegionScore.csvHeader, inline = None, baseFileName + ".csv")
        case Some("shapefile") =>
          outputShapefile(regionStream, baseFileName, shapefileCreator.createRegionShapefile, shapefileCreator)
        case _ =>
          outputGeoJSON(regionStream, inline = Some(true), baseFileName + ".json")
      }
    }).flatMap(identity) // Flatten the Future[Result] to return a Future[Result].
  }
}
