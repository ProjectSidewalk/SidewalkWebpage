package controllers

import controllers.base._
import controllers.helper.ControllerUtils.{isAdmin, parseIntegerSeq, regionsParam, NoUserId}
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

/**
 * The Gallery's controller, including its review-list mode (#5444).
 */
object GalleryController {

  /**
   * How many ids a `?labelIds=` review list may name.
   *
   * A ground-truth review pass is a few hundred labels, which keeps the URL well under the ~4 KB every browser and
   * proxy handles and stays one `IN (...)` query. The cap is applied server-side on both the page request and the
   * label request, so a longer list is truncated rather than trusted.
   */
  val MaxLabelIds: Int = 500
}

@Singleton
class GalleryController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    val config: Configuration,
    implicit val ec: ExecutionContext,
    configService: ConfigService,
    labelService: LabelService,
    panoDataService: PanoDataService,
    cropService: CropService,
    galleryService: GalleryService,
    regionService: RegionService
)(implicit assets: AssetsFinder)
    extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config

  /**
   * Returns the Gallery page.
   *
   * Mobile visitors are served the page itself (it is responsive) rather than being redirected to /mobileLanding.
   *
   * @param neighborhoods Old name for `regions`, still read so existing links keep working.
   * @param labelIds      A comma-separated review list (#5444). When it names at least one label, the page shows
   *                      exactly those labels in that order and every other filter above is ignored.
   */
  def gallery(
      labelType: String,
      regions: String,
      severities: String,
      tags: List[String],
      validationOptions: String,
      aiValidationOptions: String,
      neighborhoods: String,
      labelIds: String
  ): Action[AnyContent] =
    cc.securityService.UserAwareAction { implicit request =>
      // The label type filter is a list, and an empty one means every type — which is what the legacy "Assorted"
      // value, and anything else unrecognized, falls back to.
      val labTypes: Seq[String] =
        labelType.split(",").map(_.trim).filter(LabelTypeEnum.labelTypeNames.contains).toSeq

      // Nothing here depends on anything else, so start all three before the for-comprehension sequences them.
      val regionsF: Future[Seq[Region]] = regionService.getAllRegions
      val allTagsF: Future[Seq[Tag]]    = labelService.getTagsForCurrentCity
      val commonDataF                   = configService.getCommonPageData(request2Messages.lang)

      for {
        allRegions <- regionsF
        allTags    <- allTagsF
        commonData <- commonDataF
      } yield {
        // Cards name the region a label sits in, so the page carries the id -> name map the labels key into.
        val regionNames: Map[Int, String] = allRegions.map(r => r.regionId -> r.name).toMap
        // A tag only survives from the URL if it belongs to a label type being shown, in this city.
        val possibleTags: Seq[String] = allTags
          .filter(t => labTypes.isEmpty || labTypes.contains(t.labelType.name))
          .map(_.tag)

        // Make sure that list of region IDs, severities, and validation options are formatted correctly.
        val regionIdsList: Seq[Int] =
          parseIntegerSeq(regionsParam(Some(regions), Some(neighborhoods))).filter(regionNames.contains)
        val validSeverities: Seq[String] = Seq("null", "1", "2", "3")
        val severityList: Seq[String]    = {
          val tokens = severities.split(",").filter(validSeverities.contains).distinct.toSeq
          if (tokens.isEmpty) validSeverities else tokens
        }
        // One occurrence per tag (?tags=a&tags=b), so a tag whose name contains a comma survives — "yellow box,
        // accessibility features not visible" is a real one, and a joined list shredded it into two halves that
        // named nothing, silently dropping the filter (#4783). Older comma-joined links still work: a value is
        // only split once it fails to name a tag on its own.
        val tagList: List[String] = tags.flatMap { entry =>
          val whole = entry.trim
          if (possibleTags.contains(whole)) Seq(whole)
          else whole.split(",").map(_.trim).filter(possibleTags.contains).toSeq
        }
        val valOptions: Seq[String] =
          validationOptions.split(",").filter(Seq("correct", "incorrect", "unsure", "unvalidated").contains(_)).toSeq
        val aiValOptions: Seq[String] =
          aiValidationOptions
            .split(",")
            .filter(Seq("correct", "incorrect", "unsure", "unvalidated").contains(_))
            .toSeq

        // parseIntegerSeq drops tokens that aren't integers and dedups, preserving order. A dropped token can't be
        // reported back — the page never learns it existed — so only ids that parsed reach the unavailable list.
        val requestedIds: Seq[Int] = parseIntegerSeq(labelIds)
        val labelIdList: Seq[Int]  = requestedIds.take(GalleryController.MaxLabelIds)
        // The cap has to be visible on the page: a review list is a completeness promise, and silently serving the
        // first 500 of 600 tells the reviewer they have seen everything when they have not.
        val idsOverCap: Int = requestedIds.size - labelIdList.size

        // Log visit to Gallery async. A review list logs its length, not its ids: it can be 500 of them, and the
        // question the log answers is how often list mode is used, not on what.
        val listSuffix: String  = if (labelIdList.isEmpty) "" else s"_LabelIdList=${labelIdList.size}"
        val activityStr: String =
          s"Visit_Gallery_LabelType=${labTypes.mkString("+")}_RegionIDs=${regionIdsList}_Severity=${severityList}_Tags=${tagList}_Validations=$valOptions$listSuffix"
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, activityStr)

        Ok(
          views.html.apps.gallery(commonData, Messages("seo.title.gallery"), request.identity, labTypes, allTags,
            regionIdsList, regionNames, severityList, tagList, valOptions, aiValOptions, labelIdList, idsOverCap)
        )
      }
    }

  /**
   * Returns labels of specified type, severities, and tags.
   *
   * A read-only POST (the filter payload is JSON, hence not a GET), so it is user-aware rather than secured (#4643):
   * the Gallery and the landing page's validation grid must populate for cookie-less visitors too. With no identity,
   * the "already validated by you"/"your own label" checks match nothing, same as a brand-new anonymous account.
   */
  def getLabels: Action[JsValue] = cc.securityService.UserAwareAction(parse.json) { implicit request =>
    val submission = request.body.validate[GalleryLabelsRequest]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        val n: Int = submission.n
        // An empty set of types means "every type", which is what the landing grid and the Gallery's default ask for.
        val labelTypes: Set[LabelTypeEnum.Base] =
          submission.labelTypes.getOrElse(Seq()).flatMap(LabelTypeEnum.byName.get).toSet
        val loadedLabels: Set[Int]       = submission.loadedLabels.toSet
        val valOptions: Set[String]      = submission.validationOptions.getOrElse(Seq()).toSet
        val regionIds: Set[Int]          = submission.regionIds.getOrElse(Seq()).toSet
        val severities: Set[Option[Int]] =
          submission.severities.getOrElse(Seq()).toSet.map { (s: String) => if (s == "null") None else Some(s.toInt) }
        val tagsByLabelType: Map[LabelTypeEnum.Base, Set[String]] = submission.tagsByLabelType
          .getOrElse(Map())
          .flatMap { case (name, tags) => LabelTypeEnum.byName.get(name).map(_ -> tags.toSet) }
        val aiValOptions: Set[String]  = submission.aiValidationOptions.getOrElse(Seq()).toSet
        val userId: String             = request.identity.map(_.userId).getOrElse(NoUserId)
        val recentFirst: Boolean       = submission.sort.contains("recent")
        val staticImageryOnly: Boolean = submission.staticImageryOnly.getOrElse(false)
        // The client's list is never trusted for length or uniqueness; the same cap applies as on the page request.
        val labelIdList: Seq[Int] = submission.labelIds.getOrElse(Seq()).distinct.take(GalleryController.MaxLabelIds)

        // Get labels from LabelTable.
        labelService
          .getGalleryLabels(n, labelTypes, loadedLabels, valOptions, regionIds, severities, tagsByLabelType,
            aiValOptions, userId, recentFirst, staticImageryOnly, labelIdList)
          .flatMap { labels =>
            cropService.cropMarkers(labels.map(_.labelId)).map { markers =>
              val jsonList = labels.map { l =>
                Json.obj(
                  "label" -> (LabelFormats.validationLabelMetadataToJson(
                    l,
                    panoDataService.backupImageUrl(l.panoId),
                    currUsername = request.identity.map(_.username)
                  ) + ("can_edit" -> Json.toJson(l.fromCurrentUser || isAdmin(request.identity)))),
                  "cropUrl"     -> panoDataService.cropUrl(l.labelId, l.labelType),
                  "cropMarker"  -> markers.get(l.labelId),
                  "gsvImageUrl" ->
                    panoDataService.getImageUrl(l.panoId, l.panoSource, l.pov.heading, l.pov.pitch, l.pov.zoom)
                )
              }
              // Only a review list gets the extra key, so the landing grid's response shape is untouched. The
              // reviewer has to be able to tell "this id isn't in this city / its imagery is gone" from a list that
              // came back whole, which a silently shorter grid can't say.
              val body = Json.obj("labelsOfType" -> jsonList)
              if (labelIdList.isEmpty) Ok(body)
              else {
                val returnedIds: Set[Int] = labels.map(_.labelId).toSet
                Ok(body + ("unavailableLabelIds" -> Json.toJson(labelIdList.filterNot(returnedIds))))
              }
            }
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
