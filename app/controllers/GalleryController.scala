package controllers

import controllers.base._
import controllers.helper.ControllerUtils.{isMobile, parseIntegerSeq}
import formats.json.GalleryFormats._
import formats.json.LabelFormats
import models.auth.DefaultEnv
import models.label.{LabelTypeEnum, Tag}
import models.region.Region
import play.api.Configuration
import play.api.i18n.Messages
import play.api.libs.json.{JsError, JsValue, Json}
import play.api.mvc.{Action, AnyContent}
import play.silhouette.api.Silhouette
import service._

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class GalleryController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    val config: Configuration,
    implicit val ec: ExecutionContext,
    configService: ConfigService,
    labelService: LabelService,
    panoDataService: PanoDataService,
    galleryService: GalleryService,
    regionService: RegionService
)(implicit assets: AssetsFinder)
    extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config

  /**
   * Returns the Gallery page.
   */
  def gallery(
      labelType: String,
      neighborhoods: String,
      severities: String,
      tags: String,
      validationOptions: String,
      aiValidationOptions: String
  ): Action[AnyContent] =
    cc.securityService.SecuredAction { implicit request =>
      if (isMobile(request)) {
        cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Gallery_RedirectMobileLanding")
        Future.successful(Redirect("/mobileLanding"))
      } else {
        // The label type filter is a list, and an empty one means every type — which is what the legacy "Assorted"
        // value, and anything else unrecognized, falls back to.
        val labTypes: Seq[String] =
          labelType.split(",").map(_.trim).filter(LabelTypeEnum.validLabelTypes.contains).toSeq

        for {
          regions: Seq[Region] <- regionService.getAllRegions
          allTags: Seq[Tag]    <- labelService.getTagsForCurrentCity
          commonData           <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          // Cards name the neighborhood a label sits in, so the page carries the id -> name map the labels key into.
          val regionNames: Map[Int, String] = regions.map(r => r.regionId -> r.name).toMap
          // A tag only survives from the URL if it belongs to a label type being shown, in this city.
          val possibleTags: Seq[String] = allTags
            .filter(t =>
              labTypes.isEmpty || LabelTypeEnum.labelTypeIdToLabelType.get(t.labelTypeId).exists(labTypes.contains)
            )
            .map(_.tag)

          // Make sure that list of region IDs, severities, and validation options are formatted correctly.
          val regionIdsList: Seq[Int]      = parseIntegerSeq(neighborhoods).filter(regionNames.contains)
          val validSeverities: Seq[String] = Seq("null", "1", "2", "3")
          val severityList: Seq[String]    = {
            val tokens = severities.split(",").filter(validSeverities.contains).distinct.toSeq
            if (tokens.isEmpty) validSeverities else tokens
          }
          val tagList: List[String]   = tags.split(",").filter(possibleTags.contains).toList
          val valOptions: Seq[String] =
            validationOptions.split(",").filter(Seq("correct", "incorrect", "unsure", "unvalidated").contains(_)).toSeq
          val aiValOptions: Seq[String] =
            aiValidationOptions
              .split(",")
              .filter(Seq("correct", "incorrect", "unsure", "unvalidated").contains(_))
              .toSeq

          // Log visit to Gallery async.
          val activityStr: String =
            s"Visit_Gallery_LabelType=${labTypes.mkString("+")}_RegionIDs=${regionIdsList}_Severity=${severityList}_Tags=${tagList}_Validations=$valOptions"
          cc.loggingService.insert(request.identity.userId, request.ipAddress, activityStr)

          Ok(
            views.html.apps.gallery(commonData, Messages("seo.title.gallery"), request.identity, labTypes, allTags,
              regionIdsList, regionNames, severityList, tagList, valOptions, aiValOptions)
          )
        }
      }
    }

  /**
   * Returns labels of specified type, severities, and tags.
   */
  def getLabels: Action[JsValue] = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[GalleryLabelsRequest]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        val n: Int = submission.n
        // An empty set of types means "every type", which is what the landing grid and the Gallery's default ask for.
        val labelTypes: Set[LabelTypeEnum.Base] =
          submission.labelTypeIds.getOrElse(Seq()).flatMap(LabelTypeEnum.byId.get).toSet
        val loadedLabels: Set[Int]       = submission.loadedLabels.toSet
        val valOptions: Set[String]      = submission.validationOptions.getOrElse(Seq()).toSet
        val regionIds: Set[Int]          = submission.regionIds.getOrElse(Seq()).toSet
        val severities: Set[Option[Int]] =
          submission.severities.getOrElse(Seq()).toSet.map { (s: String) => if (s == "null") None else Some(s.toInt) }
        val tagsByLabelType: Map[LabelTypeEnum.Base, Set[String]] = submission.tagsByLabelType
          .getOrElse(Map())
          .flatMap { case (name, tags) => LabelTypeEnum.byName.get(name).map(_ -> tags.toSet) }
        val aiValOptions: Set[String]  = submission.aiValidationOptions.getOrElse(Seq()).toSet
        val userId: String             = request.identity.userId
        val recentFirst: Boolean       = submission.sort.contains("recent")
        val staticImageryOnly: Boolean = submission.staticImageryOnly.getOrElse(false)

        // Get labels from LabelTable.
        labelService
          .getGalleryLabels(n, labelTypes, loadedLabels, valOptions, regionIds, severities, tagsByLabelType,
            aiValOptions, userId, recentFirst, staticImageryOnly)
          .map { labels =>
            val jsonList = labels.map { l =>
              Json.obj(
                "label" -> LabelFormats.validationLabelMetadataToJson(
                  l,
                  panoDataService.backupImageUrl(l.panoId),
                  currUsername = Some(request.identity.username)
                ),
                "cropUrl"     -> panoDataService.cropUrl(l.labelId, l.labelType),
                "gsvImageUrl" ->
                  panoDataService.getImageUrl(l.panoId, l.panoSource, l.pov.heading, l.pov.pitch, l.pov.zoom)
              )
            }
            Ok(Json.obj("labelsOfType" -> jsonList))
          }
      }
    )
  }

  /**
   * Parse submitted gallery data and insert it into the database, only responding once the writes have committed.
   */
  def post = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[Seq[GalleryTaskSubmission]]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        galleryService
          .submitGalleryTasks(submission, request.ipAddress, request.identity.userId)
          .map(_ => Ok("Got request"))
      }
    )
  }
}
