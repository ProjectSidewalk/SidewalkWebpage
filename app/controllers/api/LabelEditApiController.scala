package controllers.api

import controllers.base.CustomControllerComponents
import models.api.{ApiError, LabelEditDataForApi, LabelEditFiltersForApi}
import models.utils.CommonUtils.UiSource
import org.apache.pekko.stream.scaladsl.Source
import play.silhouette.api.Silhouette
import service.ApiService

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * v3 API for label edits (#2575): every change made to a label's severity or tags after it was placed, whether
 * submitted with a validation or made on its own from the label popup. JSON or CSV; no spatial formats, since an edit
 * carries no coordinates of its own.
 */
@Singleton
class LabelEditApiController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[models.auth.DefaultEnv],
    apiService: ApiService
)(implicit ec: ExecutionContext)
    extends BaseApiController(cc) {

  /**
   * Returns label edits according to the filters.
   *
   * @param labelId        Only edits to this label
   * @param userId         Only edits made by this user
   * @param labelTypeId    Only edits to labels of this type
   * @param editTimestamp  Only edits made at or after this ISO 8601 timestamp
   * @param source         Only edits made in this interface (e.g. "Validate", "LabelMap", "GalleryExpanded")
   * @param withValidation true for only edits submitted with a validation, false for only standalone edits
   * @param filetype       Output format: "json" (default), "csv"
   * @param inline         Whether to display the file inline or as an attachment
   */
  def getLabelEdits(
      labelId: Option[Int],
      userId: Option[String],
      labelTypeId: Option[Int],
      editTimestamp: Option[String],
      source: Option[String],
      withValidation: Option[Boolean],
      filetype: Option[String],
      inline: Option[Boolean]
  ) = silhouette.UserAwareAction.async { implicit request =>
    cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

    val parsedTimestamp = parseDateTimeParam(editTimestamp, "editTimestamp")

    val parsedSource: Either[ApiError, Option[UiSource.Value]] = source match {
      case None    => Right(None)
      case Some(s) =>
        UiSource.values.find(_.toString == s) match {
          case Some(uiSource) => Right(Some(uiSource))
          case None           =>
            Left(
              ApiError.invalidParameter(
                s"Invalid source value '$s'. Must be one of the interface names, e.g. Validate, LabelMap, " +
                  "GalleryExpanded.",
                "source"
              )
            )
        }
    }

    val firstError: Option[ApiError] = Seq(
      parsedTimestamp.left.toOption,
      parsedSource.left.toOption,
      if (filetype.contains("shapefile") || filetype.contains("geojson") || filetype.contains("geopackage"))
        Some(
          ApiError.invalidParameter(
            "Spatial formats are not supported for label edits, which carry no coordinates. Use 'json' or 'csv'.",
            "filetype"
          )
        )
      else None
    ).flatten.headOption

    firstError match {
      case Some(error) => Future.successful(badRequest(error))
      case None        =>
        val filters = LabelEditFiltersForApi(
          labelId = labelId, userId = userId, labelTypeId = labelTypeId,
          editTimestamp = parsedTimestamp.toOption.flatten, source = parsedSource.toOption.flatten,
          withValidation = withValidation
        )
        val dbDataStream: Source[LabelEditDataForApi, _] = apiService.getLabelEdits(filters, DEFAULT_BATCH_SIZE)
        val baseFileName: String                         = timestampedFilename("label_edits")

        filetype match {
          case Some("csv") => outputCSV(dbDataStream, LabelEditDataForApi.csvHeader, inline, baseFileName + ".csv")
          case _           => outputJSON(dbDataStream, inline, baseFileName + ".json")
        }
    }
  }
}
