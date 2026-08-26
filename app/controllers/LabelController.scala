package controllers

import controllers.base._
import controllers.helper.ControllerUtils.{isAdmin, parseIntegerSeq, NoUserId}
import formats.json.LabelFormats
import formats.json.ValidateFormats.{labelEditSubmissionReads, LabelEditSubmission}
import models.auth.DefaultEnv
import models.label._
import models.utils.LatLngBBox
import play.api.Logger
import play.api.libs.json._
import play.silhouette.api.Silhouette
import service.{LabelEditOutcome, LabelEditService, LabelService, PanoDataService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class LabelController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    implicit val ec: ExecutionContext,
    labelService: LabelService,
    labelEditService: LabelEditService,
    panoDataService: PanoDataService
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
    val userId: String = request.identity.map(_.userId).getOrElse(NoUserId)
    labelService.getSingleLabelMetadata(labelId, userId).map {
      case Some(metadata) =>
        Ok(
          LabelFormats.labelMetadataWithValidationToJson(metadata, request.identity.map(_.username)) ++
            Json.obj(
              "crop_url"         -> panoDataService.cropUrl(metadata.labelId, metadata.labelType),
              "backup_image_url" -> panoDataService.backupImageUrl(metadata.panoId),
              "can_edit"         -> (metadata.fromCurrentUser || isAdmin(request.identity))
            )
        )
      case None => NotFound(s"No label found with ID: $labelId")
    }
  }

  /**
   * Edits a label's severity and tags from the label popup (#2575). Allowed to the labeler and to admins. Responds
   * with the label's resulting severity and tags, which can differ from what was sent if invalid tags were dropped.
   */
  def editLabel = cc.securityService.SecuredAction(parse.json) { implicit request =>
    request.body
      .validate[LabelEditSubmission]
      .fold(
        errors => Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))),
        submission => {
          if (submission.severity.exists(s => s < 1 || s > 3)) {
            Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> "severity must be 1-3 or null")))
          } else {
            labelEditService
              .editLabel(submission.labelId, request.identity, submission.severity, submission.tags, submission.source)
              .map {
                case LabelEditOutcome.Applied(label) =>
                  Ok(Json.obj("status" -> "Success", "severity" -> label.severity, "tags" -> label.tags))
                case LabelEditOutcome.Forbidden =>
                  Forbidden(Json.obj("status" -> "Error", "message" -> "Only the labeler or an admin can edit a label"))
                case LabelEditOutcome.NotFound =>
                  NotFound(Json.obj("status" -> "Error", "message" -> s"No label found with ID: ${submission.labelId}"))
              }
          }
        }
      )
  }

  /**
   * Get all labels with the metadata needed for /labelMap, as a GeoJSON FeatureCollection of points.
   *
   * Public read: /labelMap is browsable anonymously. The admin variant with extra fields (audit_task_id,
   * has_admin_validation) is AdminController.getAllLabels at /adminapi/labels/all. The response is streamed from the
   * db in a chunked response rather than materialized in memory — a whole city's labels can be tens of MB (#3932).
   *
   * @param regions             Comma-separated region IDs to filter by.
   * @param routes              Comma-separated route IDs to filter by.
   * @param aiValidationOptions Comma-separated AI validation results to filter by. An empty-but-present value matches
   *                            no result, so `?aiValidationOptions=` yields an empty feature collection.
   * @param bbox                Bounding box to filter by, as "minLng,minLat,maxLng,maxLat" (the v3 API convention).
   *                            Unlike the params above, a malformed value is a 400 rather than silently ignored:
   *                            dropping the bbox would stream the whole city — the exact payload the viewport-scoped
   *                            LabelMap exists to avoid (#5002) — so a client bug should fail loudly.
   * @return                    GeoJSON FeatureCollection of Point features, each carrying the 11 label properties the
   *                            LabelMap renders from.
   */
  def getAllLabelsForLabelMap(
      regions: Option[String],
      routes: Option[String],
      aiValidationOptions: Option[String],
      bbox: Option[String]
  ) =
    Action {
      val parsedBbox: Option[Option[LatLngBBox]] = bbox.map(LatLngBBox.fromString)
      if (parsedBbox.contains(None)) {
        BadRequest(
          Json.obj("status" -> "Error", "message" -> "Invalid bbox format. Expected: minLng,minLat,maxLng,maxLat")
        )
      } else {
        val regionIds: Seq[Int]    = parseIntegerSeq(regions)
        val routeIds: Seq[Int]     = parseIntegerSeq(routes)
        val aiValOpts: Seq[String] = aiValidationOptions.map(_.split(",").toSeq.distinct).getOrElse(Seq())

        val labels =
          labelService.getLabelsForLabelMap(regionIds, routeIds, aiValOpts, parsedBbox.flatten, DEFAULT_BATCH_SIZE)
        // Short-lived public cache: absorbs reload/back-nav refetches while keeping mapathon "label now, see it on
        // the map" flows under a minute stale. No auth or identity-varying content here, so `public` is safe.
        streamGeoJson(labels.map(LabelFormats.labelForLabelMapToGeoJson(_, admin = false)), "labels/all")
          .withHeaders(CACHE_CONTROL -> "public, max-age=60")
      }
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
