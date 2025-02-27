package controllers

import play.silhouette.api.Silhouette

import javax.inject.{Inject, Singleton}
import models.auth.DefaultEnv
import controllers.base._
import formats.json.LabelFormat
import service.LabelService

import scala.concurrent.ExecutionContext
import models.label._
import models.user.SidewalkUserWithRole
import play.api.libs.json._

import scala.concurrent.Future
import models.gsv.GSVDataTable
import play.api.Logger


@Singleton
class LabelController @Inject() (cc: CustomControllerComponents,
                                 val silhouette: Silhouette[DefaultEnv],
                                 implicit val ec: ExecutionContext,
                                 labelService: LabelService
                                ) extends CustomBaseController(cc) {

  /**
   * Fetches the labels that a user has added in the current region they are working in.
   *
   * @param regionId Region id
   * @return A list of labels
   */
  def getLabelsToResumeMission(regionId: Int) = cc.securityService.SecuredAction { implicit request =>
    for {
      labels: Seq[ResumeLabelMetadata] <- labelService.getLabelsFromUserInRegion(regionId, request.identity.userId)
      allTags: Seq[Tag] <- labelService.selectAllTagsFuture
    } yield {
      Ok(Json.obj("labels" -> labels.map(l => LabelFormat.resumeLabelMetadatatoJson(l, allTags))))
    }
  }

  /**
    * Gets all tags in the database in JSON.
    */
  def getLabelTags() = Action.async { implicit request =>
    // TODO this should use implicit conversion maybe?
    labelService.getTagsForCurrentCity.map { tags =>
      Ok(JsArray(tags.map { tag => Json.obj(
        "tag_id" -> tag.tagId,
        "label_type" -> LabelTypeTable.labelTypeIdToLabelType(tag.labelTypeId),
        "tag" -> tag.tag,
        "mutually_exclusive_with" -> tag.mutuallyExclusiveWith
      )}))
    }
  }
}

/**
 * API to check if panos are expired on a nightly basis.
 * TODO should this be renamed or something? Is there a better place for this code to live?
 */
object LabelController {
//  def checkForGSVImagery() =  {
//    // Get as many as 5% of the panos with labels on them, or 1000, whichever is smaller. Check if the panos are expired
//    // and update the database accordingly. If there aren't enough of those remaining that haven't been checked in the
//    // last 6 months, check up to 2.5% or 500 (which ever is smaller) of the panos that are already marked as expired to
//    // make sure that they weren't marked so incorrectly.
//    val nPanos: Int = GSVDataTable.countPanosWithLabels
//    val nUnexpiredPanosToCheck: Int = Math.max(50, Math.min(1000, 0.05 * nPanos).toInt)
//    val panoIdsToCheck: List[String] = GSVDataTable.getPanoIdsToCheckExpiration(nUnexpiredPanosToCheck, expired = false)
//    Logger.info(s"Checking ${panoIdsToCheck.length} unexpired panos.")
//
//    val nExpiredPanosToCheck: Int = Math.max(25, Math.min(500, 0.025 * nPanos).toInt)
//    val expiredPanoIdsToCheck: List[String] = if (panoIdsToCheck.length < nExpiredPanosToCheck) {
//      val nRemainingExpiredPanosToCheck: Int = nExpiredPanosToCheck - panoIdsToCheck.length
//      GSVDataTable.getPanoIdsToCheckExpiration(nRemainingExpiredPanosToCheck, expired = true)
//    } else {
//      List()
//    }
//    Logger.info(s"Checking ${expiredPanoIdsToCheck.length} expired panos.")
//
//    val responses: List[Option[Boolean]] = (panoIdsToCheck ++ expiredPanoIdsToCheck).par.map { panoId =>
//      LabelTable.panoExists(panoId)
//    }.seq.toList
//    Logger.info(s"Not expired: ${responses.count(x => x == Some(true))}. Expired: ${responses.count(x => x == Some(false))}. Errors: ${responses.count(x => x.isEmpty)}.")
//  }
}
