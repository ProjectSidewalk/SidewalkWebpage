package controllers

import controllers.base._
import controllers.helper.ControllerUtils.parseIntegerSeq
import formats.json.GalleryFormats._
import formats.json.LabelFormats
import models.auth.DefaultEnv
import models.gallery.{GalleryTaskEnvironment, GalleryTaskEnvironmentTable, GalleryTaskInteraction, GalleryTaskInteractionTable}
import models.label.LabelTypeEnum
import models.pano.PanoSource
import models.utils.MyPostgresProfile
import play.api.Configuration
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.i18n.Messages
import play.api.libs.json.{JsError, JsObject, JsValue, Json}
import play.api.mvc.{Action, AnyContent, Result}
import play.silhouette.api.Silhouette
import service.{ConfigService, LabelService, PanoDataService, RegionService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class GalleryController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    val config: Configuration,
    protected val dbConfigProvider: DatabaseConfigProvider,
    implicit val ec: ExecutionContext,
    configService: ConfigService,
    labelService: LabelService,
    panoDataService: PanoDataService,
    galleryTaskInteractionTable: GalleryTaskInteractionTable,
    galleryTaskEnvironmentTable: GalleryTaskEnvironmentTable,
    regionService: RegionService
)(implicit assets: AssetsFinder)
    extends CustomBaseController(cc)
    with HasDatabaseConfigProvider[MyPostgresProfile] {
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
      val labelTypes: Seq[(String, String)] = Seq(
        ("Assorted", Messages("gallery.all")),
        (LabelTypeEnum.CurbRamp.name, Messages("curb.ramp")),
        (LabelTypeEnum.NoCurbRamp.name, Messages("missing.ramp")),
        (LabelTypeEnum.Obstacle.name, Messages("obstacle")),
        (LabelTypeEnum.SurfaceProblem.name, Messages("surface.problem")),
        (LabelTypeEnum.Occlusion.name, Messages("occlusion")),
        (LabelTypeEnum.NoSidewalk.name, Messages("no.sidewalk")),
        (LabelTypeEnum.Crosswalk.name, Messages("crosswalk")),
        (LabelTypeEnum.Signal.name, Messages("signal")),
        (LabelTypeEnum.Other.name, Messages("other"))
      )
      val labType: String = if (labelTypes.exists(x => { x._1 == labelType })) labelType else "Assorted"

      for {
        possibleRegions: Seq[Int] <- regionService.getAllRegions.map(_.map(_.regionId))
        possibleTags: Seq[String] <- {
          if (labType != "Assorted") db.run(labelService.selectTagsByLabelType(labelType).map(_.map(_.tag)))
          else Future.successful(Seq())
        }
        commonData <- configService.getCommonPageData(request2Messages.lang)
      } yield {
        // Make sure that list of region IDs, severities, and validation options are formatted correctly.
        val regionIdsList: Seq[Int] = parseIntegerSeq(neighborhoods).filter(possibleRegions.contains)
        val severityList: Seq[Int]  = parseIntegerSeq(severities).filter(s => s > 0 && s < 4)
        val tagList: List[String]   = tags.split(",").filter(possibleTags.contains).toList
        val valOptions: Seq[String] =
          validationOptions.split(",").filter(Seq("correct", "incorrect", "unsure", "unvalidated").contains(_)).toSeq
        val aiValOptions: Seq[String] =
          aiValidationOptions.split(",").filter(Seq("correct", "incorrect", "unsure", "unvalidated").contains(_)).toSeq

        // Log visit to Gallery async.
        val activityStr: String =
          s"Visit_Gallery_LabelType=${labType}_RegionIDs=${regionIdsList}_Severity=${severityList}_Tags=${tagList}_Validations=$valOptions"
        cc.loggingService.insert(request.identity.userId, request.ipAddress, activityStr)

        Ok(
          views.html.apps.gallery(commonData, "Sidewalk - Gallery", request.identity, labType, labelTypes,
            regionIdsList, severityList, tagList, valOptions, aiValOptions)
        )
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
        val n: Int                                = submission.n
        val labelType: Option[LabelTypeEnum.Base] = submission.labelTypeId.flatMap(l => LabelTypeEnum.byId.get(l))
        val loadedLabels: Set[Int]                = submission.loadedLabels.toSet
        val valOptions: Set[String]               = submission.validationOptions.getOrElse(Seq()).toSet
        val regionIds: Set[Int]                   = submission.regionIds.getOrElse(Seq()).toSet
        val severities: Set[Int]                  = submission.severities.getOrElse(Seq()).toSet
        val tags: Set[String]                     = submission.tags.getOrElse(Seq()).toSet
        val aiValOptions: Set[String]             = submission.aiValidationOptions.getOrElse(Seq()).toSet
        val userId: String                        = request.identity.userId

        // Get labels from LabelTable.
        labelService
          .getGalleryLabels(n, PanoSource.Gsv, labelType, loadedLabels, valOptions, regionIds, severities, tags,
            aiValOptions, userId)
          .map { labels =>
            val jsonList: Seq[JsObject] = labels.map(l =>
              Json.obj(
                "label"    -> LabelFormats.validationLabelMetadataToJson(l),
                "imageUrl" -> panoDataService.getImageUrl(l.panoId, l.pov.heading, l.pov.pitch, l.pov.zoom)
              )
            )
            val labelList: JsObject = Json.obj("labelsOfType" -> jsonList)
            Ok(labelList)
          }
      }
    )
  }

  /**
   * Take parsed JSON data and insert it into database.
   */
  def processGalleryTaskSubmissions(
      submission: Seq[GalleryTaskSubmission],
      ipAddress: String,
      userId: String
  ): Future[Result] = {
    for (data <- submission) yield {
      // Insert into interactions and environment tables.
      val env: GalleryEnvironmentSubmission = data.environment
      db.run(for {
        nInteractionSubmitted <- galleryTaskInteractionTable.insertMultiple(data.interactions.map { action =>
          GalleryTaskInteraction(0, action.action, action.panoId, action.note, action.timestamp, Some(userId))
        })
        _ <- galleryTaskEnvironmentTable.insert(
          GalleryTaskEnvironment(0, env.browser, env.browserVersion, env.browserWidth, env.browserHeight,
            env.availWidth, env.availHeight, env.screenWidth, env.screenHeight, env.operatingSystem, Some(ipAddress),
            env.language, Some(userId))
        )
      } yield nInteractionSubmitted)
    }
    Future.successful(Ok("Got request"))
  }

  /**
   * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON.
   */
  def postBeacon = cc.securityService.SecuredAction(parse.text) { implicit request =>
    val json       = Json.parse(request.body)
    val submission = json.validate[Seq[GalleryTaskSubmission]]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => { processGalleryTaskSubmissions(submission, request.ipAddress, request.identity.userId) }
    )
  }

  /**
   * Parse submitted gallery data and submit to tables.
   */
  def post = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[Seq[GalleryTaskSubmission]]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => { processGalleryTaskSubmissions(submission, request.ipAddress, request.identity.userId) }
    )
  }
}
