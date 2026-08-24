package controllers

import controllers.helper.SubmissionSpecHelpers
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json._
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper._
import play.api.test.FakeRequest
import play.api.test.Helpers._

import java.util.UUID

/**
 * Functional tests for `POST /label/edit` (#2575) and the `can_edit` flag `GET /label/id/:id` hands the popup:
 * authorization (the labeler or an admin), the `label_edit` + `label_history` write, folding of consecutive edits, and
 * a fold netting out. Writes against a real label, snapshotted and restored in `afterAll` along with deleting the
 * suite's rows. Cancels when the connected schema has no label with a severity (the empty CI city).
 */
class LabelEditSpec extends PlaySpec with BeforeAndAfterAll with SubmissionSpecHelpers with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  private val XHR = "X-Requested-With" -> "XMLHttpRequest"

  /** Users minted by this suite; their edits are deleted in `afterAll`. */
  private var createdUserIds: Set[String] = Set.empty

  /** Pre-test severity and tags of every real label the suite edited, restored in `afterAll`. */
  private var labelBackup: Map[Int, (Option[Int], List[String])] = Map.empty

  private case class Target(labelId: Int, labelTypeId: Int, severity: Option[Int], tags: List[String])

  /** A real, rated label to edit; the suite's users are fresh, so none of them is its labeler. */
  private def pickLabel(): Target = {
    val row = run(
      sql"""SELECT label_id, label_type_id, severity, array_to_string(tags, '|')
            FROM label
            WHERE deleted = FALSE AND tutorial = FALSE AND severity IS NOT NULL
            ORDER BY label_id
            LIMIT 1""".as[(Int, Int, Option[Int], String)]
    ).headOption.getOrElse(cancel("No rated label in the connected schema to edit."))
    val target = Target(row._1, row._2, row._3, splitTags(row._4))
    if (!labelBackup.contains(target.labelId)) labelBackup += (target.labelId -> (target.severity, target.tags))
    target
  }

  private def splitTags(joined: String): List[String] = if (joined.isEmpty) Nil else joined.split('|').toList

  /** A tag the label's type offers that the label doesn't carry and that excludes nothing, to add in an edit. */
  private def addableTag(target: Target): String = {
    run(
      sql"""SELECT tag FROM tag
            WHERE label_type_id = ${target.labelTypeId}
              AND mutually_exclusive_with IS NULL
              AND tag <> ALL(string_to_array(${target.tags.mkString("|")}, '|'))
            ORDER BY tag_id
            LIMIT 1""".as[String]
    ).headOption.getOrElse(cancel("The label's type offers no tag this spec could add."))
  }

  /** Signs up a throwaway registered user and resolves its id, so a role can be granted by a DB write. */
  private def signUpFreshUser(): (String, Seq[Cookie]) = {
    val tag   = UUID.randomUUID().toString.replace("-", "").take(20)
    val email = s"spec.$tag@example.test"
    val resp  = route(
      app,
      FakeRequest(POST, "/signUp")
        .withHeaders(XHR)
        .withFormUrlEncodedBody(
          "username"        -> s"spec$tag",
          "email"           -> email,
          "password"        -> "TestPass1",
          "passwordConfirm" -> "TestPass1",
          "terms"           -> "true",
          "returnUrl"       -> "/explore"
        )
        .withCSRFToken
    ).get
    status(resp) mustBe OK
    val userId = run(sql"SELECT user_id FROM sidewalk_login.sidewalk_user WHERE email = $email".as[String]).head
    createdUserIds += userId
    (userId, cookies(resp).toSeq)
  }

  /** Roles are resolved per request, so an existing session gains admin access at once. */
  private def grantAdmin(userId: String): Unit = {
    val _ = run(
      sqlu"""UPDATE sidewalk_login.user_role
             SET role_id = (SELECT role_id FROM sidewalk_login.role WHERE role = 'Administrator')
             WHERE user_id = $userId"""
    )
  }

  private def editBody(labelId: Int, severity: Option[Int], tags: Seq[String], source: String = "LabelMap"): JsObject =
    Json.obj("label_id" -> labelId, "severity" -> severity, "tags" -> tags, "source" -> source)

  /** Every source string a host passes to `showLabel()` in `public/js`; each has to be a `UiSource` member. */
  private val cardHostSources = Seq(
    "LabelMap", "UserMap", "SharedLabel", "LabelSearchPage", "GalleryExpanded", "AdminLabelMap", "AdminActivity",
    "AdminStories", "DashboardStories", "StoryListPage", "UserDashboard"
  )

  private def postEdit(session: Seq[Cookie], body: JsValue) =
    route(app, FakeRequest(POST, "/label/edit").withCookies(session: _*).withJsonBody(body).withCSRFToken).get

  private def labelState(labelId: Int): (Option[Int], List[String]) = {
    val row = run(
      sql"SELECT severity, array_to_string(tags, '|') FROM label WHERE label_id = $labelId".as[(Option[Int], String)]
    ).head
    (row._1, splitTags(row._2))
  }

  /** The user's edits of the label: (old_severity, new_severity, old_tags, new_tags, label_validation_id). */
  private def editsBy(
      labelId: Int,
      userId: String
  ): Seq[(Option[Int], Option[Int], List[String], List[String], Option[Int])] =
    run(
      sql"""SELECT old_severity, new_severity, array_to_string(old_tags, '|'), array_to_string(new_tags, '|'),
                   label_validation_id
            FROM label_edit
            WHERE label_id = $labelId AND user_id = $userId
            ORDER BY label_edit_id""".as[(Option[Int], Option[Int], String, String, Option[Int])]
    ).map(r => (r._1, r._2, splitTags(r._3), splitTags(r._4), r._5))

  private def historyCount(labelId: Int): Int =
    run(sql"SELECT count(*) FROM label_history WHERE label_id = $labelId".as[Int]).head

  private def historyLinkedToEdits(labelId: Int): Int =
    run(
      sql"""SELECT count(*) FROM label_history
            INNER JOIN label_edit ON label_history.label_edit_id = label_edit.label_edit_id
            WHERE label_history.label_id = $labelId""".as[Int]
    ).head

  /** A `POST /labelmap/validate` body for the label, carrying the given severity as the validator's correction. */
  private def popupVoteBody(target: Target, result: String, severity: Option[Int], undone: Boolean): JsObject = {
    val (labelType, heading, pitch, zoom) = run(
      sql"""SELECT label_type.label_type, label_point.heading, label_point.pitch, label_point.zoom
            FROM label
            INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
            INNER JOIN label_point ON label.label_id = label_point.label_id
            WHERE label.label_id = ${target.labelId}""".as[(String, Double, Double, Double)]
    ).head
    val now = java.time.OffsetDateTime.now
    Json.obj(
      "label_id"          -> target.labelId,
      "label_type"        -> labelType,
      "validation_result" -> result,
      "severity"          -> severity,
      "tags"              -> target.tags,
      "heading"           -> heading,
      "pitch"             -> pitch,
      "zoom"              -> zoom,
      "canvas_height"     -> 440,
      "canvas_width"      -> 720,
      "start_timestamp"   -> now,
      "end_timestamp"     -> now,
      "source"            -> "LabelMap",
      "undone"            -> undone,
      "redone"            -> false,
      "viewer_type"       -> "Default"
    )
  }

  private def postPopupVote(session: Seq[Cookie], body: JsValue) =
    route(app, FakeRequest(POST, "/labelmap/validate").withCookies(session: _*).withJsonBody(body).withCSRFToken).get

  override def afterAll(): Unit = {
    try {
      createdUserIds.foreach { uId =>
        val _ = run(
          DBIO.seq(
            sqlu"""DELETE FROM label_history
                   WHERE label_edit_id IN (SELECT label_edit_id FROM label_edit WHERE user_id = $uId)""",
            sqlu"DELETE FROM label_edit WHERE user_id = $uId",
            sqlu"DELETE FROM label_validation WHERE user_id = $uId",
            sqlu"DELETE FROM mission WHERE user_id = $uId"
          )
        )
      }
      labelBackup.foreach { case (labelId, (severity, tags)) =>
        val _ = run(
          sqlu"""UPDATE label SET severity = $severity, tags = string_to_array(${tags.mkString("|")}, '|')
                 WHERE label_id = $labelId"""
        )
      }
    } finally super.afterAll()
  }

  "POST /label/edit" should {
    "401 an unauthenticated edit" in {
      val resp = route(
        app,
        FakeRequest(POST, "/label/edit")
          .withHeaders("Sec-Fetch-Mode" -> "cors")
          .withJsonBody(editBody(1, Some(1), Nil))
          .withCSRFToken
      ).get
      status(resp) mustBe UNAUTHORIZED
    }

    "400 a severity outside 1-3" in {
      val target       = pickLabel()
      val (_, session) = signUpFreshUser()
      status(postEdit(session, editBody(target.labelId, Some(5), target.tags))) mustBe BAD_REQUEST
    }

    "accept the source string of every page that hosts the card" in {
      val target            = pickLabel()
      val (userId, session) = signUpFreshUser()
      grantAdmin(userId)
      // Re-sending the label's own values writes nothing, so only the body's validation is exercised.
      cardHostSources.foreach { source =>
        withClue(s"source $source: ") {
          status(postEdit(session, editBody(target.labelId, target.severity, target.tags, source))) mustBe OK
        }
      }
      editsBy(target.labelId, userId) mustBe empty
    }

    "403 a non-admin editing someone else's label, and flag the label as not editable" in {
      val target            = pickLabel()
      val (userId, session) = signUpFreshUser()
      val meta              = route(app, FakeRequest(GET, s"/label/id/${target.labelId}").withCookies(session: _*)).get
      status(meta) mustBe OK
      (contentAsJson(meta) \ "can_edit").as[Boolean] mustBe false

      val flipped = if (target.severity.contains(1)) 2 else 1
      status(postEdit(session, editBody(target.labelId, Some(flipped), target.tags))) mustBe FORBIDDEN
      labelState(target.labelId) mustBe (target.severity, target.tags)
      editsBy(target.labelId, userId) mustBe empty
    }

    "let an admin edit another user's label, fold their consecutive edits into one row, and drop a row that nets out" in {
      val target            = pickLabel()
      val extraTag          = addableTag(target)
      val (userId, session) = signUpFreshUser()
      grantAdmin(userId)
      val historyBefore = historyCount(target.labelId)

      val meta = route(app, FakeRequest(GET, s"/label/id/${target.labelId}").withCookies(session: _*)).get
      (contentAsJson(meta) \ "can_edit").as[Boolean] mustBe true

      // First change: the severity. One standalone edit from the label's old state, with its history row.
      val flipped = if (target.severity.contains(1)) 2 else 1
      val first   = postEdit(session, editBody(target.labelId, Some(flipped), target.tags))
      status(first) mustBe OK
      (contentAsJson(first) \ "severity").as[Int] mustBe flipped
      labelState(target.labelId) mustBe (Some(flipped), target.tags)
      editsBy(target.labelId, userId) mustBe Seq((target.severity, Some(flipped), target.tags, target.tags, None))
      historyCount(target.labelId) mustBe historyBefore + 1
      historyLinkedToEdits(target.labelId) mustBe 1

      // Second change moments later: a tag. It folds into the same row, whose new state moves and old state stays.
      val withTag = target.tags :+ extraTag
      val second  = postEdit(session, editBody(target.labelId, Some(flipped), withTag))
      status(second) mustBe OK
      (contentAsJson(second) \ "tags").as[Seq[String]] must contain(extraTag)
      labelState(target.labelId)._2 must contain(extraTag)
      editsBy(target.labelId, userId) mustBe Seq((target.severity, Some(flipped), target.tags, withTag, None))
      historyCount(target.labelId) mustBe historyBefore + 1

      // Putting everything back nets the fold out to nothing: the row goes, and the label is as it was.
      status(postEdit(session, editBody(target.labelId, target.severity, target.tags))) mustBe OK
      editsBy(target.labelId, userId) mustBe empty
      labelState(target.labelId) mustBe (target.severity, target.tags)
      historyCount(target.labelId) mustBe historyBefore

      // Re-sending the label's own values writes nothing.
      status(postEdit(session, editBody(target.labelId, target.severity, target.tags))) mustBe OK
      editsBy(target.labelId, userId) mustBe empty
    }
  }

  "POST /labelmap/validate" should {
    "record a change carried by an Agree as an edit linked to the vote, separate from a standalone edit, and unwind it on undo" in {
      val target            = pickLabel()
      val (userId, session) = signUpFreshUser()
      grantAdmin(userId)
      val countsBefore = run(
        sql"SELECT agree_count FROM label WHERE label_id = ${target.labelId}".as[Int]
      ).head
      val flipped = if (target.severity.contains(1)) 2 else 1
      val third   = if (flipped == 1) 2 else 1 // Differs from `flipped`, so the vote carries a real change.

      // A standalone edit first, so the vote's edit has something not to fold into.
      status(postEdit(session, editBody(target.labelId, Some(flipped), target.tags))) mustBe OK

      val agreed = postPopupVote(session, popupVoteBody(target, "Agree", Some(third), undone = false))
      status(agreed) mustBe OK
      labelState(target.labelId)._1 mustBe Some(third)
      val edits = editsBy(target.labelId, userId)
      edits.map(e => (e._1, e._2)) mustBe Seq((target.severity, Some(flipped)), (Some(flipped), Some(third)))
      edits.head._5 mustBe None
      edits(1)._5 mustBe defined

      // Undoing the vote unwinds only its own edit; the standalone one stands.
      status(postPopupVote(session, popupVoteBody(target, "Agree", Some(third), undone = true))) mustBe OK
      labelState(target.labelId)._1 mustBe Some(flipped)
      editsBy(target.labelId, userId).map(e => (e._1, e._2, e._5)) mustBe Seq((target.severity, Some(flipped), None))
      run(sql"SELECT agree_count FROM label WHERE label_id = ${target.labelId}".as[Int]).head mustBe countsBefore

      // Put the label back.
      status(postEdit(session, editBody(target.labelId, target.severity, target.tags))) mustBe OK
      labelState(target.labelId) mustBe (target.severity, target.tags)
    }
  }
}
