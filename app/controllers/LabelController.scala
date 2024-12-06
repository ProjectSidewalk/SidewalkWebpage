package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.label._
import models.user.User
import play.api.libs.json._
import play.api.mvc.Action
import scala.concurrent.Future
import models.gsv.GSVDataTable
import play.api.Logger
/**
 * Holds the HTTP requests associated with getting label data.
 *
 * @param env The Silhouette environment.
 */
class LabelController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Fetches a single label by its ID.
   *
   * @param labelId The ID of the label to find.
   * @return The label data as JSON if found, otherwise a 404 response.
   */
  def getLabelById(labelId: Int) = UserAwareAction.async { implicit request =>
    Logger.info(s"Attempting to fetch label with ID: $labelId")

    // Check if the user is authenticated
    request.identity match {
      case Some(user) =>
        LabelTable.getLabelById(labelId) match {
          case Some(label) =>
            // Map the Label object to a JSON response
            val jsLabel = Json.obj(
              "labelId" -> label.labelId,
              "description" -> label.description,
              "severity" -> label.severity,
              "tags" -> label.tags
              // Add other fields as necessary
            )
            // Return the label data as JSON
            Future.successful(Ok(jsLabel))
          case None =>
            // If label is not found, return a 404 Not Found response
            Future.successful(NotFound(Json.obj("error" -> "Label not found")))
        }
      case None =>
        // If user is not authenticated, redirect to login
        Future.successful(Redirect("/login"))
    }
  }

  /**
  * Delete a label by its ID.
  */
  def deleteLabelById(labelId: Int) = UserAwareAction.async { implicit request =>
    Logger.info(s"Attempting to delete label with ID: $labelId")

    // Check if the user is authenticated
    request.identity match {
      case Some(user) =>
        // Try to delete the label
        LabelTable.deleteLabelById(labelId) match {
          case affectedRows if affectedRows > 0 => 
            // If at least one row was affected, label is deleted
            Future.successful(Ok(Json.obj("message" -> s"Label with ID $labelId has been deleted.")))
          case _ =>
            // If no rows were affected, return a 404 response
            Future.successful(NotFound(Json.obj("error" -> "Label not found")))
        }
      case None =>
        // If the user is not authenticated, redirect to login
        Future.successful(Redirect("/login"))
    }
  }

  /**
   * Updates a label's properties (severity, description, tags).
   * 
   * @param labelId The ID of the label to update.
   * @return A JSON response indicating success or failure.
   */
  def updateFromUserDashboard(labelId: Int) = UserAwareAction.async(parse.json) { implicit request =>
    // Log the labelId for debugging purposes
    Logger.info(s"Attempting to update label with ID: $labelId")

    // Extract the JSON data from the request body
    val updatedData = request.body.as[JsObject]

    // Extract severity, description, and tags from the request body
    val severity = (updatedData \ "severity").asOpt[Int]
    val description = (updatedData \ "description").asOpt[String]
    val tags = (updatedData \ "tags").asOpt[List[String]].getOrElse(List())

    // Check if the user is authenticated
    request.identity match {
      case Some(user) =>
        // Check if the label exists
        LabelTable.getLabelById(labelId) match {
          case Some(labelToUpdate) =>
            // Proceed with updating the label
            val updateResult = LabelTable.updateFromUserDashboard(labelId, severity, description, tags)

            // If update was successful, return the updated label details
            if (updateResult > 0) {
              Future.successful(Ok(Json.obj("message" -> s"Label with ID $labelId updated successfully.")))
            } else {
              // If no rows were affected, return Not Found
              Future.successful(NotFound(Json.obj("error" -> "Label update failed or no changes made.")))
            }
          case None =>
            // If the label was not found, return Not Found
            Future.successful(NotFound(Json.obj("error" -> "Label not found")))
        }
      case None =>
        // If the user is not authenticated, redirect to login
        Future.successful(Redirect("/login"))
    }
  }

  /**
   * Fetches the labels that a user has added in the current region they are working in.
   *
   * @param regionId Region id
   * @return A list of labels
   */
  def getLabelsToResumeMission(regionId: Int) = UserAwareAction.async { implicit request =>
    // TODO move this to a format file.
    request.identity match {
      case Some(user) =>
        val allTags: List[Tag] = TagTable.selectAllTags
        val labels: List[LabelTable.ResumeLabelMetadata] = LabelTable.getLabelsFromUserInRegion(regionId, user.userId)
        val jsLabels: List[JsObject] = labels.map { label =>
          Json.obj(
            "labelId" -> label.labelData.labelId,
            "labelType" -> label.labelType,
            "panoId" -> label.labelData.gsvPanoramaId,
            "panoLat" -> label.panoLat,
            "panoLng" -> label.panoLng,
            "originalPov" -> Json.obj(
              "heading" -> label.pointData.heading,
              "pitch" -> label.pointData.pitch,
              "zoom" -> label.pointData.zoom
            ),
            "cameraHeading" -> label.cameraHeading,
            "cameraPitch" -> label.cameraPitch,
            "panoWidth" -> label.panoWidth,
            "panoHeight" -> label.panoHeight,
            "tagIds" -> label.labelData.tags.flatMap(t => allTags.filter(at => at.tag == t && Some(at.labelTypeId) == LabelTypeTable.labelTypeToId(label.labelType)).map(_.tagId).headOption),
            "severity" -> label.labelData.severity,
            "tutorial" -> label.labelData.tutorial,
            "temporaryLabelId" -> label.labelData.temporaryLabelId,
            "temporaryLabel" -> label.labelData.temporary,
            "description" -> label.labelData.description,
            "canvasX" -> label.pointData.canvasX,
            "canvasY" -> label.pointData.canvasY,
            "panoX" -> label.pointData.panoX,
            "panoY" -> label.pointData.panoY,
            "auditTaskId" -> label.labelData.auditTaskId,
            "missionId" -> label.labelData.missionId,
            "labelLat" -> label.pointData.lat,
            "labelLng" -> label.pointData.lng
          )
        }
        val labelCollection: JsObject = Json.obj("labels" -> jsLabels)
        Future.successful(Ok(labelCollection))
      case None =>
        Future.successful(Redirect(s"/anonSignUp?url=/label/resumeMission?regionId=$regionId"))
    }
  }

  /**
    * Gets all tags in the database in JSON.
    */
  def getLabelTags() = Action.async { implicit request =>
    val tags: List[Tag] = TagTable.getTagsForCurrentCity
    Future.successful(Ok(JsArray(tags.map { tag => Json.obj(
      "tag_id" -> tag.tagId,
      "label_type" -> LabelTypeTable.labelTypeIdToLabelType(tag.labelTypeId).get,
      "tag" -> tag.tag,
      "mutually_exclusive_with" -> tag.mutuallyExclusiveWith
    )})))
  }
}

/**
 * API to check if panos are expired on a nightly basis.
 */
object LabelController {
  def checkForGSVImagery() =  {
    // Get as many as 5% of the panos with labels on them, or 1000, whichever is smaller. Check if the panos are expired
    // and update the database accordingly. If there aren't enough of those remaining that haven't been checked in the
    // last 6 months, check up to 2.5% or 500 (which ever is smaller) of the panos that are already marked as expired to
    // make sure that they weren't marked so incorrectly.
    val nPanos: Int = GSVDataTable.countPanosWithLabels
    val nUnexpiredPanosToCheck: Int = Math.max(50, Math.min(1000, 0.05 * nPanos).toInt)
    val panoIdsToCheck: List[String] = GSVDataTable.getPanoIdsToCheckExpiration(nUnexpiredPanosToCheck, expired = false)
    Logger.info(s"Checking ${panoIdsToCheck.length} unexpired panos.")

    val nExpiredPanosToCheck: Int = Math.max(25, Math.min(500, 0.025 * nPanos).toInt)
    val expiredPanoIdsToCheck: List[String] = if (panoIdsToCheck.length < nExpiredPanosToCheck) {
      val nRemainingExpiredPanosToCheck: Int = nExpiredPanosToCheck - panoIdsToCheck.length
      GSVDataTable.getPanoIdsToCheckExpiration(nRemainingExpiredPanosToCheck, expired = true)
    } else {
      List()
    }
    Logger.info(s"Checking ${expiredPanoIdsToCheck.length} expired panos.")

    val responses: List[Option[Boolean]] = (panoIdsToCheck ++ expiredPanoIdsToCheck).par.map { panoId =>
      LabelTable.panoExists(panoId)
    }.seq.toList
    Logger.info(s"Not expired: ${responses.count(x => x == Some(true))}. Expired: ${responses.count(x => x == Some(false))}. Errors: ${responses.count(x => x.isEmpty)}.")
  }
}
