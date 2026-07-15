package controllers

import controllers.base._
import controllers.helper.ControllerUtils.isAdmin
import controllers.helper.SignedMediaUtils
import formats.json.StoryFormats
import models.auth.{DefaultEnv, WithAdmin}
import models.story.{Story, StoryPhotoUpload, StoryRejection}
import play.api.libs.json.{JsBoolean, Json}
import play.api.{Configuration, Logger}
import play.silhouette.api.Silhouette
import service.{ImageSigningService, RateLimiter, StoryService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/**
 * HTTP surface for lived-experience stories (#4054): public reads for the label-detail card, authenticated
 * submission (multipart, optional photo), the author's hard-delete retraction, signed media serving, and the
 * admin moderation endpoints. Stories are deliberately absent from /v3 (see StoryFormats).
 */
@Singleton
class StoryController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    config: Configuration,
    storyService: StoryService,
    signingService: ImageSigningService,
    rateLimiter: RateLimiter,
    implicit val ec: ExecutionContext
) extends CustomBaseController(cc) {
  private val logger = Logger(this.getClass)

  /**
   * All stories for a label, shaped for the viewer. Public read: the share landing (/label/:id) opens the card with
   * no session at all, so this mirrors LabelController.getLabelData's UserAwareAction (#456).
   */
  def getStories(labelId: Int) = silhouette.UserAwareAction.async { implicit request =>
    val viewerUserId = request.identity.map(_.userId)
    storyService.getStoriesForLabel(labelId, viewerUserId, isAdmin(request.identity)).map { stories =>
      Ok(
        Json.obj(
          "label_id"        -> labelId,
          "max_text_length" -> storyService.maxTextLength, // Composer counter limit; sourced here, never a JS literal.
          "stories"         -> stories.map(StoryFormats.storyForViewToJson)
        )
      )
    }
  }

  /**
   * Submits a story (multipart form). Data parts: `label_id`, `text`, optional `display_name_mode`
   * (anonymous|username, default anonymous), optional `alt_text`; optional file part `photo`.
   * Any authenticated user may post, anonymous sessions included — the same bar as label-map comments.
   */
  def submitStory = cc.securityService.SecuredAction(parse.multipartFormData) { implicit request =>
    val userId = request.identity.userId

    def dataPart(name: String): Option[String] = request.body.dataParts.get(name).flatMap(_.headOption)

    // Inert-until-enabled IP burst layer on top of the always-on per-user DB limit in StoryService.
    val ipLimit = rateLimiter.limit("story-submit")
    if (!rateLimiter.allow(s"story-submit:ip:${request.ipAddress}", ipLimit.maxAttempts, ipLimit.window)) {
      Future.successful(
        TooManyRequests(StoryFormats.rejectionToJson(StoryRejection.RateLimited))
          .withHeaders("Retry-After" -> ipLimit.window.toSeconds.toString)
      )
    } else {
      dataPart("label_id").flatMap(s => Try(s.toInt).toOption) match {
        case None          => Future.successful(BadRequest(Json.obj("error" -> "story.error.label-id-missing")))
        case Some(labelId) =>
          val text            = dataPart("text").getOrElse("")
          val displayNameMode = dataPart("display_name_mode").getOrElse(Story.DisplayNameAnonymous)
          val altText         = dataPart("alt_text").map(_.trim).filter(_.nonEmpty)
          val photo           = request.body.file("photo").map { filePart =>
            StoryPhotoUpload(filePart.ref.path.toFile, filePart.contentType.getOrElse(""), altText)
          }
          cc.loggingService.insert(
            userId,
            request.ipAddress,
            s"Click_module=StorySubmit_labelId=${labelId}_hasPhoto=${photo.isDefined}"
          )
          storyService.submitStory(labelId, userId, text, displayNameMode, photo).map {
            case Right(story)    => Ok(StoryFormats.storyForViewToJson(story))
            case Left(rejection) => rejectionResult(rejection)
          }
      }
    }
  }

  /**
   * The author's retraction: a real hard delete of the row and any media bytes (#4054). Ownership is enforced in the
   * DAO's delete predicate; a non-owner gets the same 404 as a missing story.
   */
  def deleteOwnStory(storyId: Int) = cc.securityService.SecuredAction { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, s"Click_module=StoryDelete_storyId=$storyId")
    storyService.deleteOwnStory(storyId, request.identity.userId).map { deleted =>
      if (deleted) Ok(Json.obj("success" -> true)) else NotFound(Json.obj("success" -> false))
    }
  }

  /** The signed-in user's own stories (hidden ones included), for the dashboard management list. */
  def getMyStories = cc.securityService.SecuredAction { implicit request =>
    storyService.getStoriesForUser(request.identity.userId).map { stories =>
      Ok(Json.obj("stories" -> stories.map(StoryFormats.storyForOwnerToJson)))
    }
  }

  /**
   * Serves a story photo from disk. Requires a valid HMAC signature (?exp=...&sig=...) and an allowed Referer/Origin;
   * media on a hidden story 404s unless the viewer is the author or an admin. UserAware (not Secured) because story
   * photos render for signed-out visitors on the public /label/:id page — the signed, expiring URL is the gate.
   */
  def serveStoryMedia(storyMediaId: Int) = silhouette.UserAwareAction.async { implicit request =>
    val earlyReject =
      if (!SignedMediaUtils.refererAllowed(request, config)) Some(Forbidden("Request origin not allowed."))
      else SignedMediaUtils.verifySignature(request, s"/storyMedia/$storyMediaId", signingService)

    earlyReject match {
      case Some(result) => Future.successful(result)
      case None         =>
        storyService.getMediaForServing(storyMediaId).map {
          case None                 => NotFound("Story media not found.")
          case Some((media, story)) =>
            val viewerCanSee = story.visibility == Story.VisibilityVisible ||
              request.identity.exists(_.userId == story.userId) || isAdmin(request.identity)
            val file = storyService.storyMediaFile(storyMediaId)
            if (!viewerCanSee || !file.exists()) NotFound("Story media not found.")
            else Ok.sendFile(file, inline = true).as(media.mimeType)
        }
    }
  }

  /** Most recent stories across all users, hidden included — the admin moderation queue feed. */
  def getRecentStories(n: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // The request is unused, but SecuredAction needs it and the compiler wants it read.
    storyService.getRecentStories(math.min(n, 500)).map { stories =>
      Ok(Json.obj("stories" -> stories.map(StoryFormats.storyForAdminToJson)))
    }
  }

  /** Hides (quarantines) or unhides a story. Reversible, keeps row and bytes — the retraction path is the DELETEs. */
  def setStoryVisibility(storyId: Int) = cc.securityService.SecuredAction(WithAdmin(), parse.json) { implicit request =>
    (request.body \ "hidden").asOpt[Boolean] match {
      case None => Future.successful(BadRequest(Json.obj("error" -> "Expected JSON body: {\"hidden\": Boolean}")))
      case Some(hidden) =>
        cc.loggingService.insert(
          request.identity.userId,
          request.ipAddress,
          s"Click_module=AdminStoryVisibility_storyId=${storyId}_hidden=$hidden"
        )
        storyService.setStoryVisibility(storyId, request.identity.userId, hidden).map { updated =>
          if (updated) Ok(Json.obj("success" -> true, "hidden" -> JsBoolean(hidden)))
          else NotFound(Json.obj("success" -> false))
        }
    }
  }

  /** Admin hard delete (row + bytes) — for content that must not survive even as quarantined evidence. */
  def adminDeleteStory(storyId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(
      request.identity.userId,
      request.ipAddress,
      s"Click_module=AdminStoryDelete_storyId=$storyId"
    )
    storyService.adminDeleteStory(storyId).map { deleted =>
      if (deleted) Ok(Json.obj("success" -> true)) else NotFound(Json.obj("success" -> false))
    }
  }

  /** Maps a submission rejection to its HTTP status; the body carries the i18n key + English fallback. */
  private def rejectionResult(rejection: StoryRejection) = {
    val body = StoryFormats.rejectionToJson(rejection)
    rejection match {
      case StoryRejection.LabelNotFound => NotFound(body)
      case StoryRejection.AlreadyExists => Conflict(body)
      case StoryRejection.RateLimited   => TooManyRequests(body)
      case StoryRejection.PhotoTooLarge => EntityTooLarge(body)
      case _                            => BadRequest(body)
    }
  }
}
