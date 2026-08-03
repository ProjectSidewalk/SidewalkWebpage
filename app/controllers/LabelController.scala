package controllers

import controllers.base._
import controllers.helper.ControllerUtils.parseIntegerSeq
import executors.CpuIntensiveExecutionContext
import formats.json.LabelFormats
import models.auth.DefaultEnv
import models.label._
import play.api.Logger
import play.api.libs.json._
import play.silhouette.api.Silhouette
import service.{LabelService, PanoDataService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

@Singleton
class LabelController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    implicit val ec: ExecutionContext,
    labelService: LabelService,
    panoDataService: PanoDataService,
    cpuEc: CpuIntensiveExecutionContext
) extends CustomBaseController(cc) {

  private val logger = Logger(this.getClass)

  /**
   * Fetches the labels that a user has added in the current region they are working in.
   * @param regionId Region id
   * @return A list of labels
   */
  def getLabelsToResumeMission(regionId: Int) = cc.securityService.SecuredAction { implicit request =>
    for {
      labels: Seq[ResumeLabelMetadata] <- labelService.getLabelsFromUserInRegion(regionId, request.identity.userId)
      allTags: Seq[Tag]                <- labelService.selectAllTagsFuture
    } yield {
      Ok(Json.obj("labels" -> labels.map(l => LabelFormats.resumeLabelMetadatatoJson(l, allTags))))
    }
  }

  /**
   * Gets the total label count in a region across all users.
   * @param regionId Region id
   */
  def getRegionLabelCount(regionId: Int) = cc.securityService.SecuredAction { implicit request =>
    logger.debug(request.toString) // The request is unused, but SecuredAction needs it and the compiler wants it read.
    labelService.countLabelsInRegion(regionId).map { labelCount => Ok(Json.obj("label_count" -> labelCount)) }
  }

  /**
   * Get metadata for a given label ID (excludes personal identifiers like username).
   *
   * Backs the shared label-detail popup on Gallery/LabelMap. Public read (#456): the share landing (/label/:id)
   * opens the popup anonymously, so per-user fields (userValidation, fromCurrentUser) fall back to "no user" when
   * there's no signed-in identity. The admin variant with personal identifiers is AdminController.getAdminLabelData.
   */
  def getLabelData(labelId: Int) = silhouette.UserAwareAction.async { implicit request =>
    val userId: String = request.identity.map(_.userId).getOrElse("")
    labelService.getSingleLabelMetadata(labelId, userId).map {
      case Some(metadata) =>
        Ok(
          LabelFormats.labelMetadataWithValidationToJson(metadata, request.identity.map(_.username)) ++
            Json.obj(
              "crop_url"         -> panoDataService.cropUrl(metadata.labelId, metadata.labelType),
              "backup_image_url" -> panoDataService.backupImageUrl(metadata.panoId)
            )
        )
      case None => NotFound(s"No label found with ID: $labelId")
    }
  }

  /**
   * Get all labels with the metadata needed for /labelMap, as a GeoJSON FeatureCollection of points.
   *
   * Public read: /labelMap is browsable anonymously. The admin variant with extra fields (audit_task_id,
   * has_admin_validation) is AdminController.getAllLabels at /adminapi/labels/all.
   *
   * @param regions             Comma-separated region IDs to filter by.
   * @param routes              Comma-separated route IDs to filter by.
   * @param aiValidationOptions Comma-separated AI validation results to filter by. An empty-but-present value matches
   *                            no result, so `?aiValidationOptions=` yields an empty feature collection.
   * @return                    GeoJSON FeatureCollection of Point features, each carrying the 11 label properties the
   *                            LabelMap renders from.
   */
  def getAllLabelsForLabelMap(regions: Option[String], routes: Option[String], aiValidationOptions: Option[String]) =
    Action.async {
      val regionIds: Seq[Int]    = parseIntegerSeq(regions)
      val routeIds: Seq[Int]     = parseIntegerSeq(routes)
      val aiValOpts: Seq[String] = aiValidationOptions.map(_.split(",").toSeq.distinct).getOrElse(Seq())

      labelService
        .getLabelsForLabelMap(regionIds, routeIds, aiValOpts)
        .map { labels =>
          val features: Seq[JsObject] = labels.map { label =>
            Json.obj(
              "type"     -> "Feature",
              "geometry" -> Json.obj(
                "type"        -> "Point",
                "coordinates" -> Json.arr(label.lng, label.lat)
              ),
              "properties" -> Json.obj(
                "label_id"          -> label.labelId,
                "label_type"        -> label.labelType,
                "severity"          -> label.severity,
                "correct"           -> label.correct,
                "has_validations"   -> label.hasValidations,
                "ai_validation"     -> label.aiValidation.map(_.toString),
                "expired"           -> label.expired,
                "has_backup"        -> label.hasBackup,
                "high_quality_user" -> label.highQualityUser,
                "ai_generated"      -> label.aiGenerated,
                "tags"              -> label.tags
              )
            )
          }
          val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
          Ok(featureCollection)
        }(cpuEc)
    }

  /**
   * Gets all tags in the database in JSON.
   */
  def getLabelTags = silhouette.UserAwareAction.async { implicit request =>
    logger.debug(request.toString)

    // TODO this should use implicit conversion maybe?
    labelService.getTagsForCurrentCity.map { tags =>
      Ok(JsArray(tags.map { tag =>
        Json.obj(
          "tag_id"                  -> tag.tagId,
          "label_type"              -> LabelTypeEnum.labelTypeIdToLabelType(tag.labelTypeId),
          "tag"                     -> tag.tag,
          "mutually_exclusive_with" -> tag.mutuallyExclusiveWith
        )
      }))
    }
  }
}
