package controllers

import controllers.helper.SubmissionSpecHelpers
import models.label.LabelTable
import models.user.UserStatTable
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsArray, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._
import _root_.util.SignedUpAccounts

import java.time.OffsetDateTime

/**
 * Functional tests for `DELETE /label/:id` and `POST /label/:id/restore` (#3591): authorization, the delete stamp and
 * its removal on restore, an admin's delete filing a Disagree, and the accuracy rule. A real label is handed to the suite's fresh user for the duration and
 * put back in `afterAll`. Cancels when the connected schema has no label.
 */
class LabelDeleteSpec
    extends PlaySpec
    with BeforeAndAfterAll
    with SubmissionSpecHelpers
    with SignedUpAccounts
    with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  private lazy val userStatTable = app.injector.instanceOf[UserStatTable]
  private lazy val labelTable    = app.injector.instanceOf[LabelTable]

  /** The label's real labeler and verdict, restored in `afterAll`. */
  private case class Backup(labelId: Int, userId: String, correct: Option[Boolean])
  private var backups: Seq[Backup] = Seq.empty

  /** Hands a real, live label to the given user and returns its id. */
  private def adoptLabel(userId: String): Int = {
    val row = run(
      sql"""SELECT label_id, user_id, correct
            FROM label
            WHERE deleted = FALSE AND tutorial = FALSE AND label_id > ${backups.map(_.labelId).maxOption.getOrElse(0)}
            ORDER BY label_id
            LIMIT 1""".as[(Int, String, Option[Boolean])]
    ).headOption.getOrElse(cancel("No live label in the connected schema to adopt."))
    backups :+= Backup(row._1, row._2, row._3)
    val _ = run(sqlu"UPDATE label SET user_id = $userId WHERE label_id = ${row._1}")
    row._1
  }

  /** (deleted, deleted_by, deleted_at is set, deleted_source). */
  private def deletionOf(labelId: Int): (Boolean, Option[String], Boolean, Option[String]) =
    run(
      sql"""SELECT deleted, deleted_by, deleted_at IS NOT NULL, deleted_source::text
            FROM label WHERE label_id = $labelId""".as[(Boolean, Option[String], Boolean, Option[String])]
    ).head

  /** The user's (own_labels_validated, accuracy). */
  private def accuracyOf(userId: String): (Int, Option[Double]) =
    run(
      sql"SELECT own_labels_validated, accuracy FROM user_stat WHERE user_id = $userId".as[(Int, Option[Double])]
    ).head

  /** Sets a verdict on the label and refreshes the labeler's stored accuracy from it. */
  private def setVerdict(labelId: Int, userId: String, correct: Option[Boolean]): Unit = {
    val _ = run(
      sqlu"UPDATE label SET correct = $correct WHERE label_id = $labelId" >> userStatTable.updateAccuracy(Seq(userId))
    )
  }

  /** The user's votes on the label as (validation_result, source). */
  private def votesBy(labelId: Int, userId: String): Seq[(String, String)] =
    run(
      sql"""SELECT validation_result::text, source::text FROM label_validation
            WHERE label_id = $labelId AND user_id = $userId ORDER BY label_validation_id""".as[(String, String)]
    )

  private def disagreeCountOf(labelId: Int): Int =
    run(sql"SELECT disagree_count FROM label WHERE label_id = $labelId".as[Int]).head

  private def grantAdmin(userId: String): Unit = {
    val _ = run(sqlu"UPDATE sidewalk_login.user_role SET role = 'Administrator' WHERE user_id = $userId")
  }

  private def delete(session: Seq[Cookie], labelId: Int, source: String = "UserDashboard") =
    route(app, FakeRequest(DELETE, s"/label/$labelId?source=$source").withCookies(session: _*).withCSRFToken).get

  private def restore(session: Seq[Cookie], labelId: Int) =
    route(app, FakeRequest(POST, s"/label/$labelId/restore").withCookies(session: _*).withCSRFToken).get

  override def afterAll(): Unit = {
    try {
      createdUserIds.foreach { uId =>
        val _ = run(
          sqlu"DELETE FROM label_validation WHERE user_id = $uId" >> sqlu"DELETE FROM mission WHERE user_id = $uId"
        )
      }
      backups.foreach { b =>
        val _ = run(
          sqlu"""UPDATE label
                 SET user_id = ${b.userId}, correct = ${b.correct}, deleted = FALSE, deleted_by = NULL,
                     deleted_at = NULL, deleted_source = NULL
                 WHERE label_id = ${b.labelId}""" >> labelTable.recalculateValidationCountsForLabel(b.labelId)
        )
      }
    } finally super.afterAll()
  }

  "DELETE /label/:id" should {
    "401 an unauthenticated delete" in {
      val resp = route(
        app,
        FakeRequest(DELETE, "/label/1?source=UserDashboard").withHeaders("Sec-Fetch-Mode" -> "cors").withCSRFToken
      ).get
      status(resp) mustBe UNAUTHORIZED
    }

    "400 a source that is not a UiSource, and 404 a label that does not exist" in {
      val (userId, _, session) = signUpFreshUser()
      val labelId              = adoptLabel(userId)
      status(delete(session, labelId, "NotAPage")) mustBe BAD_REQUEST
      deletionOf(labelId)._1 mustBe false
      status(delete(session, -1)) mustBe NOT_FOUND
    }

    "403 a stranger, and file an admin's delete of someone else's label as a Disagree only an admin can undo" in {
      val (ownerId, _, ownerSession) = signUpFreshUser()
      val (otherId, _, session)      = signUpFreshUser()
      val labelId                    = adoptLabel(ownerId)
      status(delete(session, labelId)) mustBe FORBIDDEN
      deletionOf(labelId)._1 mustBe false

      grantAdmin(otherId)
      val disagreesBefore = disagreeCountOf(labelId)
      status(delete(session, labelId, "LabelMap")) mustBe OK
      deletionOf(labelId) mustBe ((true, Some(otherId), true, Some("LabelMap")))
      votesBy(labelId, otherId) mustBe Seq(("Disagree", "LabelMap"))
      disagreeCountOf(labelId) mustBe disagreesBefore + 1

      // The labeler can't undo an admin's delete; the admin can, and the vote stands.
      status(restore(ownerSession, labelId)) mustBe FORBIDDEN
      deletionOf(labelId)._1 mustBe true
      status(restore(session, labelId)) mustBe OK
      deletionOf(labelId) mustBe ((false, None, false, None))
      votesBy(labelId, otherId).size mustBe 1

      // An admin deleting their own label is just a delete.
      val ownLabelId = adoptLabel(otherId)
      status(delete(session, ownLabelId)) mustBe OK
      votesBy(ownLabelId, otherId) mustBe empty
    }

    "stamp the labeler's delete, keep the stamp on a repeat, and clear it on restore" in {
      val (userId, _, session) = signUpFreshUser()
      val labelId              = adoptLabel(userId)

      val deleted = delete(session, labelId, "LabelMap")
      status(deleted) mustBe OK
      (contentAsJson(deleted) \ "deleted").as[Boolean] mustBe true
      deletionOf(labelId) mustBe ((true, Some(userId), true, Some("LabelMap")))

      // The first stamp is the one that counts.
      status(delete(session, labelId, "UserDashboard")) mustBe OK
      deletionOf(labelId) mustBe ((true, Some(userId), true, Some("LabelMap")))

      val restored = restore(session, labelId)
      status(restored) mustBe OK
      (contentAsJson(restored) \ "deleted").as[Boolean] mustBe false
      deletionOf(labelId) mustBe ((false, None, false, None))
      status(restore(session, labelId)) mustBe OK
      deletionOf(labelId) mustBe ((false, None, false, None))
    }

    "tell the card whether the label is deleted and whether the viewer may restore it" in {
      val (ownerId, _, ownerSession)                      = signUpFreshUser()
      val (otherId, _, otherSession)                      = signUpFreshUser()
      val labelId                                         = adoptLabel(ownerId)
      def flags(session: Seq[Cookie]): (Boolean, Boolean) = {
        val json = contentAsJson(route(app, FakeRequest(GET, s"/label/id/$labelId").withCookies(session: _*)).get)
        ((json \ "deleted").as[Boolean], (json \ "can_restore").as[Boolean])
      }
      flags(ownerSession) mustBe ((false, false))
      status(delete(ownerSession, labelId)) mustBe OK
      flags(ownerSession) mustBe ((true, true))
      flags(otherSession) mustBe ((true, false))
      grantAdmin(otherId)
      flags(otherSession) mustBe ((true, true))
    }

    "drop a vote that arrives after the label was deleted" in {
      val (ownerId, _, ownerSession) = signUpFreshUser()
      val (voterId, _, voterSession) = signUpFreshUser()
      val labelId                    = adoptLabel(ownerId)
      val label = contentAsJson(route(app, FakeRequest(GET, s"/label/id/$labelId").withCookies(voterSession: _*)).get)
      status(delete(ownerSession, labelId)) mustBe OK
      val now  = OffsetDateTime.now
      val vote = Json.obj(
        "label_id"          -> labelId,
        "label_type"        -> (label \ "label_type").as[String],
        "validation_result" -> "Disagree",
        "severity"          -> (label \ "severity").asOpt[Int],
        "tags"              -> (label \ "tags").as[JsArray],
        "heading"           -> (label \ "heading").as[Double],
        "pitch"             -> (label \ "pitch").as[Double],
        "zoom"              -> (label \ "zoom").as[Double],
        "canvas_width"      -> 720,
        "canvas_height"     -> 440,
        "start_timestamp"   -> now,
        "end_timestamp"     -> now,
        "source"            -> "LabelMap",
        "undone"            -> false,
        "redone"            -> false,
        "viewer_type"       -> "Default"
      )
      val resp = route(
        app,
        FakeRequest(POST, "/labelmap/validate").withCookies(voterSession: _*).withJsonBody(vote).withCSRFToken
      ).get
      status(resp) mustBe OK
      votesBy(labelId, voterId) mustBe empty
    }

    "keep an incorrect verdict in the labeler's accuracy but drop a correct one" in {
      val (userId, _, session) = signUpFreshUser()
      val labelId              = adoptLabel(userId)

      // Judged incorrect: the delete keeps it counted.
      setVerdict(labelId, userId, Some(false))
      accuracyOf(userId) mustBe ((1, Some(0.0)))
      status(delete(session, labelId)) mustBe OK
      accuracyOf(userId) mustBe ((1, Some(0.0)))
      status(restore(session, labelId)) mustBe OK
      accuracyOf(userId) mustBe ((1, Some(0.0)))

      // Judged correct: deleting it gives up the credit.
      setVerdict(labelId, userId, Some(true))
      accuracyOf(userId) mustBe ((1, Some(1.0)))
      status(delete(session, labelId)) mustBe OK
      accuracyOf(userId) mustBe ((0, None))
      status(restore(session, labelId)) mustBe OK
      accuracyOf(userId) mustBe ((1, Some(1.0)))
    }
  }
}
