package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ShapefilesCreatorHelper
import models.computation.StreamingApiType
import models.api.{ApiError, LabelData, RawLabelFilters, LabelTagDetails}
import models.utils.LatLngBBox
import models.label.{LabelAllMetadata, LabelCVMetadata, LabelTypeTable}
import models.utils.MapParams
import formats.json.ApiFormats._

import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Source
import play.api.i18n.Lang.logger
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService, GsvDataService, LabelService}
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import java.time.OffsetDateTime

@Singleton
class LabelApiController @Inject()(cc: CustomControllerComponents,
                               val silhouette: Silhouette[models.auth.DefaultEnv],
                               apiService: ApiService,
                               configService: ConfigService,
                               gsvDataService: service.GsvDataService,
                               labelService: LabelService,
                               shapefileCreator: ShapefilesCreatorHelper
                              )(implicit ec: ExecutionContext, mat: Materializer) extends BaseApiController(cc) {

  /**
   * Returns all the raw labels within the bounding box in given file format.
   * @param lat1 First latitude value for the bounding box
   * @param lng1 First longitude value for the bounding box
   * @param lat2 Second latitude value for the bounding box
   * @param lng2 Second longitude value for the bounding box
   * @param filetype One of "csv", "shapefile", or "geojson"
   * @param inline Whether to display the file inline or as an attachment.
   */
  def getRawLabelsV2(lat1: Option[Double], lng1: Option[Double], lat2: Option[Double], lng2: Option[Double], filetype: Option[String], inline: Option[Boolean]) = silhouette.UserAwareAction.async { implicit request =>
    for {
      cityMapParams: MapParams <- configService.getCityMapParams
    } yield {
      // Set up streaming data from the database.
      val bbox: LatLngBBox = createBBox(lat1, lng1, lat2, lng2, cityMapParams)
      val dbDataStream: Source[LabelAllMetadata, _] = apiService.getAllLabelMetadata(bbox, DEFAULT_BATCH_SIZE)
      val baseFileName: String = s"rawLabels_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV, Shapefile, or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          outputCSV(dbDataStream, LabelAllMetadata.csvHeader, inline, baseFileName + ".csv")
        case Some("shapefile") =>
          outputShapefile(dbDataStream, baseFileName, shapefileCreator.createLabelAllMetadataShapeFile, shapefileCreator)
        case _ =>
          outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
      }
    }
  }
  
  /**
   * Get metadata used for 2022 CV project for all labels, and output as JSON.
   * @param filetype One of "csv" or "json".
   * @param inline Whether to display the file inline or as an attachment.
   */
  def getAllLabelMetadataForCV(filetype: Option[String], inline: Option[Boolean]) = silhouette.UserAwareAction.async { implicit request =>
    // Set up streaming data from the database.
    val dbDataStream: Source[LabelCVMetadata, _] = apiService.getLabelCVMetadata(DEFAULT_BATCH_SIZE)
    val baseFileName: String = s"labelsWithCVMetadata_${OffsetDateTime.now()}"
    cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

    // Output data in the appropriate file format: CSV or JSON (default).
    filetype match {
      case Some("csv") =>
        Future.successful(outputCSV(dbDataStream, LabelCVMetadata.csvHeader, inline, baseFileName + ".csv"))
      case _ =>
        Future.successful(outputJSON(dbDataStream, inline, baseFileName + ".json"))
    }
  }
  
  /**
  * Returns a list of all label types with metadata including icons and colors.
  *
  * @return JSON response containing label type information
  */
  def getLabelTypes = silhouette.UserAwareAction.async { implicit request =>
    apiService.getLabelTypes().map { types =>
      val labelTypeDetailsList = types.toList.sortBy(_.id)
      
      Ok(Json.obj(
        "status" -> "OK", 
        "labelTypes" -> labelTypeDetailsList
      ))
    }.recover {
      case e: Exception =>
        InternalServerError(Json.toJson(
          ApiError.internalServerError(s"Failed to retrieve label types: ${e.getMessage}")
        ))
    }
  }

  /**
   * Returns a list of all label tags with their metadata for the current city.
   *
   * This endpoint provides information about available label tags for the current city,
   * including their IDs, associated label types, tag names, and mutual exclusivity rules.
   *
   * @return JSON response containing label tag information
   */
  def getLabelTags = silhouette.UserAwareAction.async { implicit request =>
    labelService.getTagsForCurrentCity.map { tags =>
      val formattedTags = tags.map { tag =>
        // Convert the mutuallyExclusiveWith Option[String] to Seq[String]
        val mutuallyExclusiveList = tag.mutuallyExclusiveWith
          .map(_.split(",").map(_.trim).filter(_.nonEmpty).toSeq)
          .getOrElse(Seq.empty[String])
          
        LabelTagDetails(
          id = tag.tagId,
          labelType = LabelTypeTable.labelTypeIdToLabelType(tag.labelTypeId),
          tag = tag.tag,
          mutuallyExclusiveWith = mutuallyExclusiveList
        )
      }
      
      Ok(Json.obj(
        "status" -> "OK", 
        "labelTags" -> formattedTags
      ))
    }.recover {
      case e: Exception =>
        InternalServerError(Json.toJson(
          ApiError.internalServerError(s"Failed to retrieve label tags: ${e.getMessage}")
        ))
    }
  }

  /**
  * v3 API: Returns all sidewalk labels within the specified parameters.
  *
  * Note that if a bbox is provided, it takes precedence over region filters.
  * If a region ID is provided, it takes precedence over region name.
  * 
  * @param bbox Bounding box in format "minLon,minLat,maxLon,maxLat"
  * @param label_type Comma-separated list of label types to include
  * @param tag Comma-separated list of tags to filter by
  * @param min_severity Minimum severity score (1-5 scale)
  * @param max_severity Maximum severity score (1-5 scale)
  * @param validation_status Filter by validation status: "validated_correct", "validated_incorrect", "unvalidated"
  * @param start_date Start date for filtering (ISO 8601 format)
  * @param end_date End date for filtering (ISO 8601 format)
  * @param region_id Optional region ID to filter by geographic region
  * @param region_name Optional region name to filter by geographic region
  * @param filetype Output format: "geojson" (default), "csv", "shapefile", "geopackage"
  * @param inline Whether to display the file inline or as an attachment
  */
  def getRawLabelsV3(
    bbox: Option[String],
    label_type: Option[String],
    tag: Option[String],
    min_severity: Option[Int],
    max_severity: Option[Int],
    validation_status: Option[String],
    start_date: Option[String],
    end_date: Option[String],
    region_id: Option[Int],
    region_name: Option[String],
    filetype: Option[String],
    inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    for {
      cityMapParams: MapParams <- configService.getCityMapParams
    } yield {
      // Parse bbox parameter
      val parsedBbox: Option[LatLngBBox] = bbox.flatMap { b =>
        try {
          val parts = b.split(",").map(_.trim.toDouble)
          if (parts.length == 4) {
            Some(LatLngBBox(
              minLng = parts(0),
              minLat = parts(1),
              maxLng = parts(2),
              maxLat = parts(3)
            ))
          } else {
            None
          }
        } catch {
          case _: Exception => None
        }
      }
      
      // If bbox isn't provided, use city defaults
      val apiBox = parsedBbox.getOrElse(
        LatLngBBox(
          minLng = Math.min(cityMapParams.lng1, cityMapParams.lng2),
          minLat = Math.min(cityMapParams.lat1, cityMapParams.lat2),
          maxLng = Math.max(cityMapParams.lng1, cityMapParams.lng2),
          maxLat = Math.max(cityMapParams.lat1, cityMapParams.lat2)
        )
      )
      
      // Parse date strings to OffsetDateTime if provided
      val parsedStartDate = start_date.flatMap { s =>
        try {
          Some(OffsetDateTime.parse(s))
        } catch {
          case _: Exception => None
        }
      }
      
      val parsedEndDate = end_date.flatMap { e =>
        try {
          Some(OffsetDateTime.parse(e))
        } catch {
          case _: Exception => None
        }
      }
      
      // Parse comma-separated lists into sequences
      val parsedLabelTypes = label_type.map(_.split(",").map(_.trim).toSeq)
      val parsedTags = tag.map(_.split(",").map(_.trim).toSeq)
      
      // Map validation status to internal representation
      val validationStatusMapped = validation_status.map {
        case "validated_correct" => "Agreed"
        case "validated_incorrect" => "Disagreed"
        case "unvalidated" => "Unvalidated"
        case _ => null
      }
      
      // Apply filter precedence logic
      // If bbox is defined, it takes precedence over region filters
      val finalBbox = if (bbox.isDefined && parsedBbox.isDefined) {
        parsedBbox
      } else if (region_id.isDefined || region_name.isDefined) {
        // If region filters are used, bbox should be None
        None
      } else {
        // Default city bbox
        Some(apiBox)
      }
      
      // Apply region filter precedence logic
      // If bbox is defined, ignore region filters
      // If region_id is defined, it takes precedence over region_name
      val finalRegionId = if (bbox.isDefined && parsedBbox.isDefined) {
        None
      } else {
        region_id
      }
      
      val finalRegionName = if (bbox.isDefined && parsedBbox.isDefined || region_id.isDefined) {
        None
      } else {
        region_name
      }
      
      // Create filters object
      val filters = RawLabelFilters(
        bbox = finalBbox,
        labelTypes = parsedLabelTypes,
        tags = parsedTags,
        minSeverity = min_severity,
        maxSeverity = max_severity,
        validationStatus = validationStatusMapped.filter(_ != null),
        startDate = parsedStartDate,
        endDate = parsedEndDate,
        regionId = finalRegionId,
        regionName = finalRegionName
      )
      
      // Get the data stream
      val dbDataStream: Source[LabelData, _] = apiService.getRawLabelsV3(filters, DEFAULT_BATCH_SIZE)
      val baseFileName: String = s"labels_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Handle error cases
      if (bbox.isDefined && parsedBbox.isEmpty) {
        BadRequest(Json.toJson(ApiError.invalidParameter(
          "Invalid value for bbox parameter. Expected format: minLon,minLat,maxLon,maxLat.", "bbox")))
      } else if (validation_status.isDefined && validationStatusMapped.isEmpty) {
        BadRequest(Json.toJson(ApiError.invalidParameter(
          "Invalid validation_status value. Must be one of: validated_correct, validated_incorrect, unvalidated", 
          "validation_status")))
      } else if (region_id.isDefined && region_id.get <= 0) {
        BadRequest(Json.toJson(ApiError.invalidParameter(
          "Invalid region_id value. Must be a positive integer.", "region_id")))
      } else {
        // Output data in the appropriate file format
        filetype match {
          case Some("csv") =>
            outputCSV(dbDataStream, LabelData.csvHeader, inline, baseFileName + ".csv")
          case Some("shapefile") =>
            outputShapefile(dbDataStream, baseFileName, shapefileCreator.createRawLabelShapeFile, shapefileCreator)
          case Some("geopackage") =>
            outputGeopackage(dbDataStream, baseFileName, shapefileCreator)
          case _ => // Default to GeoJSON
            outputGeoJSON(dbDataStream, inline, baseFileName + ".json")
        }
      }
    }
  }

  /**
   * Retrieves all panorama IDs that have labels.
   *
   * This method is an asynchronous action that fetches all panoramas with labels
   * from the `gsvDataService`. The result is a JSON response containing a list of
   * panorama IDs, where each panorama is serialized into JSON format.
   *
   * @return An asynchronous result containing an HTTP response with a JSON array
   *         of panorama IDs and their associated labels.
   */
  def getAllPanoIdsWithLabels = Action.async {
    gsvDataService.getAllPanosWithLabels.map { panos =>
      Ok(Json.toJson(panos.map(p => Json.toJson(p))))
    }
  }
}