package controllers

import models.story.Story
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.Files.SingletonTemporaryFileCreator
import play.api.libs.json.{JsArray, JsValue}
import play.api.mvc.{Cookie, MultipartFormData}
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.{LabelService, StoryService}

import java.awt.image.BufferedImage
import javax.imageio.ImageIO
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Functional tests for the lived-experience story endpoints (#4054). Boots the real app against Postgres (applying
 * evolution 336 forward), exercising the full stack: routing, CSRF, Silhouette anon sessions, multipart parsing, the
 * photo re-encode pipeline, signed media serving, and the hard-delete retraction contract (row AND bytes gone).
 *
 * Story-creating tests clean up after themselves via the retraction endpoint, so repeated runs against the shared dev
 * DB don't accumulate rows. Label ids are sourced from the connected DB; tests cancel (not fail) when the DB lacks
 * enough labels to exercise a path.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class StoryControllerSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  implicit lazy val mat: Materializer = app.materializer

  private val labelService: LabelService = app.injector.instanceOf[LabelService]
  private val storyService: StoryService = app.injector.instanceOf[StoryService]
  private val maxTextLength: Int         = app.configuration.get[Int]("stories.max-text-length")
  private val maxPerDay: Int             = app.configuration.get[Int]("stories.max-per-user-per-day")

  private lazy val labelIds: Seq[Int] =
    Await.result(labelService.getRecentLabelMetadata(50), 60.seconds).map(_.labelId).distinct

  /** Mints a fresh anonymous session (a distinct persistent user per call) and returns its cookies. */
  private def freshAnonSession(): Seq[Cookie] = {
    val resp = route(app, FakeRequest(GET, "/anonSignUp?url=%2F")).get
    status(resp) mustBe SEE_OTHER
    cookies(resp).toSeq
  }

  private def multipartBody(
      dataParts: Map[String, Seq[String]],
      files: Seq[MultipartFormData.FilePart[play.api.libs.Files.TemporaryFile]] = Seq.empty
  ) =
    MultipartFormData(dataParts = dataParts, files = files, badParts = Nil)

  private def postStory(
      session: Seq[Cookie],
      labelId: Int,
      text: String,
      extraParts: Map[String, Seq[String]] = Map.empty,
      files: Seq[MultipartFormData.FilePart[play.api.libs.Files.TemporaryFile]] = Seq.empty
  ) = {
    val body = multipartBody(Map("label_id" -> Seq(labelId.toString), "text" -> Seq(text)) ++ extraParts, files)
    route(
      app,
      FakeRequest(POST, "/userapi/stories").withCookies(session: _*).withMultipartFormDataBody(body).withCSRFToken
    ).get
  }

  private def deleteStory(session: Seq[Cookie], storyId: Int) =
    route(app, FakeRequest(DELETE, s"/userapi/stories/$storyId").withCookies(session: _*).withCSRFToken).get

  private def getStories(labelId: Int, session: Seq[Cookie] = Seq.empty) =
    route(app, FakeRequest(GET, s"/stories?labelId=$labelId").withCookies(session: _*)).get

  private def storiesArray(json: JsValue): Seq[JsValue] = (json \ "stories").as[JsArray].value.toSeq

  /** A real JPEG on disk, wide enough (2600px) that the ingest pipeline's 2560px edge cap must downscale it. */
  private def testJpegFilePart(): MultipartFormData.FilePart[play.api.libs.Files.TemporaryFile] = {
    val img  = new BufferedImage(2600, 400, BufferedImage.TYPE_INT_RGB)
    val temp = SingletonTemporaryFileCreator.create("story-spec", ".jpg")
    ImageIO.write(img, "jpg", temp.path.toFile) mustBe true
    MultipartFormData.FilePart(key = "photo", filename = "story-spec.jpg", contentType = Some("image/jpeg"), ref = temp)
  }

  "GET /stories" should {
    "be readable with no session at all (public share-page contract) and carry the composer's text limit" in {
      labelIds.headOption match {
        case None     => cancel("No labels in the connected test DB.")
        case Some(id) =>
          val resp = getStories(id)
          status(resp) mustBe OK
          (contentAsJson(resp) \ "label_id").as[Int] mustBe id
          (contentAsJson(resp) \ "max_text_length").as[Int] mustBe maxTextLength
          (contentAsJson(resp) \ "stories").asOpt[JsArray] mustBe defined
      }
    }
  }

  "POST /userapi/stories" should {
    "reject an unauthenticated submission" in {
      labelIds.headOption match {
        case None     => cancel("No labels in the connected test DB.")
        case Some(id) =>
          val body = multipartBody(Map("label_id" -> Seq(id.toString), "text" -> Seq("hello")))
          val resp = route(app, FakeRequest(POST, "/userapi/stories").withMultipartFormDataBody(body).withCSRFToken).get
          status(resp) must not be OK
      }
    }

    "accept a text-only story from an anonymous session, echo it on the card read, and hard-delete on retraction" in {
      labelIds.headOption match {
        case None     => cancel("No labels in the connected test DB.")
        case Some(id) =>
          val session = freshAnonSession()
          val text    = "Spec story: this corner blocks my commute."
          val posted  = postStory(session, id, text)
          status(posted) mustBe OK
          val storyId = (contentAsJson(posted) \ "story_id").as[Int]

          // The author sees their story flagged is_own; a signed-out reader sees it anonymous.
          val ownRead = storiesArray(contentAsJson(getStories(id, session)))
            .find(s => (s \ "story_id").as[Int] == storyId)
          ownRead mustBe defined
          (ownRead.get \ "is_own").as[Boolean] mustBe true
          (ownRead.get \ "display_name").asOpt[String] mustBe None

          val publicRead = storiesArray(contentAsJson(getStories(id)))
            .find(s => (s \ "story_id").as[Int] == storyId)
          publicRead mustBe defined
          (publicRead.get \ "is_own").as[Boolean] mustBe false
          (publicRead.get \ "text").as[String] mustBe text

          status(deleteStory(session, storyId)) mustBe OK
          storiesArray(contentAsJson(getStories(id))).exists(s => (s \ "story_id").as[Int] == storyId) mustBe false
      }
    }

    "reject empty text, over-long text, and an invalid display-name mode" in {
      labelIds.headOption match {
        case None     => cancel("No labels in the connected test DB.")
        case Some(id) =>
          val session = freshAnonSession()
          status(postStory(session, id, "   ")) mustBe BAD_REQUEST
          status(postStory(session, id, "x" * (maxTextLength + 1))) mustBe BAD_REQUEST
          status(postStory(session, id, "valid text", Map("display_name_mode" -> Seq("full-legal-name")))) mustBe
            BAD_REQUEST
      }
    }

    "404 a story on a nonexistent label" in {
      val session = freshAnonSession()
      status(postStory(session, Int.MaxValue, "story for a label that does not exist")) mustBe NOT_FOUND
    }

    "409 a second story by the same user on the same label" in {
      labelIds.headOption match {
        case None     => cancel("No labels in the connected test DB.")
        case Some(id) =>
          val session = freshAnonSession()
          val posted  = postStory(session, id, "first story")
          status(posted) mustBe OK
          val storyId = (contentAsJson(posted) \ "story_id").as[Int]
          try status(postStory(session, id, "second story on the same label")) mustBe CONFLICT
          finally { val _ = status(deleteStory(session, storyId)) }
      }
    }

    "429 once the per-user daily cap is reached" in {
      if (labelIds.size < maxPerDay + 1) {
        cancel(s"Needs ${maxPerDay + 1} distinct labels in the connected test DB; found ${labelIds.size}.")
      }
      val session = freshAnonSession()
      val posted  = labelIds.take(maxPerDay).map { id =>
        val resp = postStory(session, id, s"rate-limit spec story for label $id")
        status(resp) mustBe OK
        (contentAsJson(resp) \ "story_id").as[Int]
      }
      try status(postStory(session, labelIds(maxPerDay), "one over the daily cap")) mustBe TOO_MANY_REQUESTS
      finally posted.foreach(storyId => status(deleteStory(session, storyId)) mustBe OK)
    }

    "ingest a photo (re-encoded, resized, signed URL), serve it, and remove the bytes on retraction" in {
      labelIds.headOption match {
        case None     => cancel("No labels in the connected test DB.")
        case Some(id) =>
          val session = freshAnonSession()
          val posted  = postStory(
            session,
            id,
            "story with a photo",
            Map("alt_text" -> Seq("A test image.")),
            files = Seq(testJpegFilePart())
          )
          status(posted) mustBe OK
          val json    = contentAsJson(posted)
          val storyId = (json \ "story_id").as[Int]
          val media   = (json \ "media").as[JsValue]
          val mediaId = (media \ "story_media_id").as[Int]
          (media \ "mime_type").as[String] mustBe "image/jpeg"
          (media \ "alt_text").as[String] mustBe "A test image."
          // 2600x400 source, 2560 edge cap -> downscaled, aspect preserved.
          (media \ "width").as[Int] mustBe 2560
          (media \ "height").as[Int] must be < 400

          val mediaUrl = (media \ "url").as[String]
          mediaUrl must startWith(s"/storyMedia/$mediaId?exp=")
          val served = route(app, FakeRequest(GET, mediaUrl)).get
          status(served) mustBe OK
          contentType(served) mustBe Some("image/jpeg")

          // Tampered signature is rejected.
          status(route(app, FakeRequest(GET, s"/storyMedia/$mediaId?exp=9999999999&sig=bogus")).get) mustBe FORBIDDEN

          // Retraction contract: row and bytes both go, so a still-unexpired signed URL serves nothing.
          status(deleteStory(session, storyId)) mustBe OK
          storyService.storyMediaFile(mediaId).exists() mustBe false
          status(route(app, FakeRequest(GET, mediaUrl)).get) mustBe NOT_FOUND
      }
    }

    "reject a non-image upload posing as a photo" in {
      labelIds.headOption match {
        case None     => cancel("No labels in the connected test DB.")
        case Some(id) =>
          val session = freshAnonSession()
          val temp    = SingletonTemporaryFileCreator.create("story-spec-not-image", ".jpg")
          java.nio.file.Files.write(temp.path, "definitely not a JPEG".getBytes)
          val part = MultipartFormData.FilePart(
            key = "photo",
            filename = "fake.jpg",
            contentType = Some("image/jpeg"),
            ref = temp
          )
          status(postStory(session, id, "story with a fake photo", files = Seq(part))) mustBe BAD_REQUEST
      }
    }
  }

  "DELETE /userapi/stories/:storyId" should {
    "not let one user retract another user's story" in {
      labelIds.headOption match {
        case None     => cancel("No labels in the connected test DB.")
        case Some(id) =>
          val author = freshAnonSession()
          val other  = freshAnonSession()
          val posted = postStory(author, id, "story that only its author may retract")
          status(posted) mustBe OK
          val storyId = (contentAsJson(posted) \ "story_id").as[Int]
          try {
            status(deleteStory(other, storyId)) mustBe NOT_FOUND
            storiesArray(contentAsJson(getStories(id))).exists(s => (s \ "story_id").as[Int] == storyId) mustBe true
          } finally { val _ = status(deleteStory(author, storyId)) }
      }
    }
  }

  "moderation" should {
    "hide a story from the public card while keeping it visible (flagged) to its author" in {
      labelIds.headOption match {
        case None     => cancel("No labels in the connected test DB.")
        case Some(id) =>
          val session = freshAnonSession()
          val posted  = postStory(session, id, "story that gets quarantined")
          status(posted) mustBe OK
          val storyId = (contentAsJson(posted) \ "story_id").as[Int]
          try {
            Await.result(storyService.setStoryVisibility(storyId, "spec-admin", hidden = true), 30.seconds) mustBe true

            storiesArray(contentAsJson(getStories(id))).exists(s => (s \ "story_id").as[Int] == storyId) mustBe false
            val ownView = storiesArray(contentAsJson(getStories(id, session)))
              .find(s => (s \ "story_id").as[Int] == storyId)
            ownView mustBe defined
            (ownView.get \ "hidden").as[Boolean] mustBe true

            Await.result(storyService.setStoryVisibility(storyId, "spec-admin", hidden = false), 30.seconds) mustBe true
            storiesArray(contentAsJson(getStories(id))).exists(s => (s \ "story_id").as[Int] == storyId) mustBe true
          } finally { val _ = status(deleteStory(session, storyId)) }
      }
    }

    "reject the adminapi endpoints for a non-admin session" in {
      val session = freshAnonSession()
      status(route(app, FakeRequest(GET, "/adminapi/stories").withCookies(session: _*)).get) must not be OK
      val put = FakeRequest(PUT, "/adminapi/stories/1/visibility")
        .withCookies(session: _*)
        .withJsonBody(play.api.libs.json.Json.obj("hidden" -> true))
        .withCSRFToken
      status(route(app, put).get) must not be OK
      val del = FakeRequest(DELETE, "/adminapi/stories/1").withCookies(session: _*).withCSRFToken
      status(route(app, del).get) must not be OK
    }
  }

  "story visibility constants" should {
    "match the evolution's CHECK constraints" in {
      Story.VisibilityVisible mustBe "visible"
      Story.VisibilityHidden mustBe "hidden"
      Story.validDisplayNameModes mustBe Set("anonymous", "username")
    }
  }
}
