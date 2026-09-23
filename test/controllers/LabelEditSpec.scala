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
import _root_.util.SignedUpAccounts

/**
 * Functional tests for `POST /label/edit` (#2575) and the `can_edit` flag `GET /label/id/:id` hands the popup:
 * authorization (the labeler or an admin), the `label_edit` + `label_history` write, folding of consecutive edits, and
 * a fold netting out. Writes against a real label, snapshotted and restored in `afterAll` along with deleting the
 * suite's rows. Cancels when the connected schema has no label with a severity (the empty CI city).
 */
class LabelEditSpec
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

  private lazy val labelTable = app.injector.instanceOf[models.label.LabelTable]

  /** Pre-test type, severity and tags of every real label the suite edited, restored in `afterAll`. */
  private var labelBackup: Map[Int, Target] = Map.empty

  private case class Target(labelId: Int, labelType: String, severity: Option[Int], tags: List[String])

  /**
   * A real, rated label to edit; the suite's users are fresh, so none of them is its labeler.
   * @param where Extra SQL conditions on `label`, for the type-change cases.
   */
  private def pickLabel(where: String = ""): Target = {
    val row = run(
      sql"""SELECT label_id, label_type::text, severity, array_to_string(tags, '|')
            FROM label
            WHERE deleted = FALSE AND tutorial = FALSE AND severity IS NOT NULL #$where
            ORDER BY label_id
            LIMIT 1""".as[(Int, String, Option[Int], String)]
    ).headOption.getOrElse(cancel("No rated label in the connected schema to edit."))
    val target = Target(row._1, row._2, row._3, splitTags(row._4))
    if (!labelBackup.contains(target.labelId)) labelBackup += (target.labelId -> target)
    target
  }

  /**
   * An Obstacle or SurfaceProblem (both rated on the Severity scale, so a change between them keeps the severity) that
   * belongs to no cluster, since a type change takes a label out of its cluster and the suite shouldn't move real ones.
   *
   * Every vote on it must also name its current type, which the cases below assume when they expect a change to leave
   * the label with no counted votes. A vote stamped with some other type is a leftover from an interrupted run in a
   * dev database, and picking that label would fail the count assertions rather than the behavior they check.
   */
  private def pickTypeChangeLabel(): Target = pickLabel(
    """AND label_type IN ('Obstacle', 'SurfaceProblem')
       AND NOT EXISTS (SELECT 1 FROM cluster_label WHERE cluster_label.label_id = label.label_id)
       AND NOT EXISTS (SELECT 1 FROM label_validation
                       WHERE label_validation.label_id = label.label_id
                         AND label_validation.label_type <> label.label_type)"""
  )

  private def otherSeverityType(labelType: String): String =
    if (labelType == "Obstacle") "SurfaceProblem" else "Obstacle"

  private def splitTags(joined: String): List[String] = if (joined.isEmpty) Nil else joined.split('|').toList

  /** A tag the label's type offers that the label doesn't carry and that excludes nothing, to add in an edit. */
  private def addableTag(target: Target): String = {
    run(
      sql"""SELECT tag FROM tag
            WHERE label_type::text = ${target.labelType}
              AND mutually_exclusive_with IS NULL
              AND tag <> ALL(string_to_array(${target.tags.mkString("|")}, '|'))
            ORDER BY tag_id
            LIMIT 1""".as[String]
    ).headOption.getOrElse(cancel("The label's type offers no tag this spec could add."))
  }

  /** Roles are resolved per request, so an existing session gains admin access at once. */
  private def grantAdmin(userId: String): Unit = {
    val _ = run(
      sqlu"""UPDATE sidewalk_login.user_role
             SET role = 'Administrator'
             WHERE user_id = $userId"""
    )
  }

  private def editBody(labelId: Int, severity: Option[Int], tags: Seq[String], source: String = "LabelMap"): JsObject =
    Json.obj("label_id" -> labelId, "severity" -> severity, "tags" -> tags, "source" -> source)

  /** An edit body that also says which type the popup showed and which type the label should become. */
  private def typeEditBody(
      labelId: Int,
      labelTypeSeen: String,
      newLabelType: String,
      severity: Option[Int],
      tags: Seq[String]
  ): JsObject =
    editBody(labelId, severity, tags) ++ Json.obj("label_type" -> labelTypeSeen, "new_label_type" -> newLabelType)

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

  /** The label's (type, severity, tags, agree_count, disagree_count, unsure_count, correct). */
  private def fullState(labelId: Int): (String, Option[Int], List[String], Int, Int, Int, Option[Boolean]) = {
    val r = run(
      sql"""SELECT label_type::text, severity, array_to_string(tags, '|'), agree_count, disagree_count, unsure_count,
                   correct
            FROM label WHERE label_id = $labelId""".as[(String, Option[Int], String, Int, Int, Int, Option[Boolean])]
    ).head
    (r._1, r._2, splitTags(r._3), r._4, r._5, r._6, r._7)
  }

  /** The user's edits of the label as (old_label_type, new_label_type, old_severity, new_severity, new_tags). */
  private def typeEditsBy(labelId: Int, userId: String): Seq[(String, String, Option[Int], Option[Int], List[String])] =
    run(
      sql"""SELECT old_label_type::text, new_label_type::text, old_severity, new_severity, array_to_string(new_tags, '|')
            FROM label_edit
            WHERE label_id = $labelId AND user_id = $userId
            ORDER BY label_edit_id""".as[(String, String, Option[Int], Option[Int], String)]
    ).map(r => (r._1, r._2, r._3, r._4, splitTags(r._5)))

  /** The user's votes on the label as (label_type, validation_result). */
  private def votesBy(labelId: Int, userId: String): Seq[(String, String)] =
    run(
      sql"""SELECT label_type::text, validation_result::text FROM label_validation
            WHERE label_id = $labelId AND user_id = $userId ORDER BY label_validation_id""".as[(String, String)]
    )

  private def tagsFor(labelType: String): Set[String] =
    run(sql"SELECT tag FROM tag WHERE label_type::text = $labelType".as[String]).toSet

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

  /**
   * A `POST /labelmap/validate` body for the label, carrying the given severity (and type, when given) as the
   * validator's correction.
   */
  private def popupVoteBody(
      target: Target,
      result: String,
      severity: Option[Int],
      undone: Boolean,
      newLabelType: Option[String] = None
  ): JsObject = {
    val (labelType, heading, pitch, zoom) = run(
      sql"""SELECT label.label_type::text, label_point.heading, label_point.pitch, label_point.zoom
            FROM label
            INNER JOIN label_point ON label.label_id = label_point.label_id
            WHERE label.label_id = ${target.labelId}""".as[(String, Double, Double, Double)]
    ).head
    val now = java.time.OffsetDateTime.now
    Json.obj(
      "label_id"          -> target.labelId,
      "label_type"        -> labelType,
      "new_label_type"    -> newLabelType,
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
      labelBackup.foreach { case (labelId, t) =>
        // Recount after putting the type back, or the next run starts from counts taken at the other type.
        val _ = run(
          sqlu"""UPDATE label SET label_type = ${t.labelType}::label_type, severity = ${t.severity},
                     tags = string_to_array(${t.tags.mkString("|")}, '|')
                 WHERE label_id = $labelId""" >> labelTable.recalculateValidationCountsForLabel(labelId)
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
      val target          = pickLabel()
      val (_, _, session) = signUpFreshUser()
      status(postEdit(session, editBody(target.labelId, Some(5), target.tags))) mustBe BAD_REQUEST
    }

    "accept the source string of every page that hosts the card" in {
      val target               = pickLabel()
      val (userId, _, session) = signUpFreshUser()
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
      val target               = pickLabel()
      val (userId, _, session) = signUpFreshUser()
      val meta = route(app, FakeRequest(GET, s"/label/id/${target.labelId}").withCookies(session: _*)).get
      status(meta) mustBe OK
      (contentAsJson(meta) \ "can_edit").as[Boolean] mustBe false

      val flipped = if (target.severity.contains(1)) 2 else 1
      status(postEdit(session, editBody(target.labelId, Some(flipped), target.tags))) mustBe FORBIDDEN
      labelState(target.labelId) mustBe (target.severity, target.tags)
      editsBy(target.labelId, userId) mustBe empty
    }

    "let an admin edit another user's label, fold their consecutive edits into one row, and drop a row that nets out" in {
      val target               = pickLabel()
      val extraTag             = addableTag(target)
      val (userId, _, session) = signUpFreshUser()
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

  "POST /label/edit with a new_label_type" should {
    "change the type, keep a same-scale severity, drop tags the new type lacks, recount votes, and refuse a stale client" in {
      val target               = pickTypeChangeLabel()
      val other                = otherSeverityType(target.labelType)
      val (userId, _, session) = signUpFreshUser()
      grantAdmin(userId)
      val before = fullState(target.labelId)

      // Obstacle <-> SurfaceProblem: both rated on the Severity scale, so the severity stays; tags are re-checked.
      val changed =
        postEdit(session, typeEditBody(target.labelId, target.labelType, other, target.severity, target.tags))
      status(changed) mustBe OK
      (contentAsJson(changed) \ "label_type").as[String] mustBe other
      val afterChange = fullState(target.labelId)
      afterChange._1 mustBe other
      afterChange._2 mustBe target.severity
      afterChange._3.toSet must be(afterChange._3.toSet intersect tagsFor(other))
      // Every real vote on this label was cast on the old type, so none counts any more.
      (afterChange._4, afterChange._5, afterChange._6, afterChange._7) mustBe ((0, 0, 0, None))
      typeEditsBy(target.labelId, userId).map(e => (e._1, e._2, e._4)) mustBe
        Seq((target.labelType, other, target.severity))

      // A rating given with a change to a type on the other scale is a rating for the new type, so it stands.
      val fresh = if (target.severity.contains(3)) 1 else 3
      status(postEdit(session, typeEditBody(target.labelId, other, "CurbRamp", Some(fresh), Nil))) mustBe OK
      fullState(target.labelId)._2 mustBe Some(fresh)

      // An unrated type carries no severity, whatever the client sent.
      status(postEdit(session, typeEditBody(target.labelId, "CurbRamp", "Signal", Some(2), Nil))) mustBe OK
      val asSignal = fullState(target.labelId)
      (asSignal._1, asSignal._2) mustBe (("Signal", None))

      // A client still showing the original type is told the label moved on, and changes nothing.
      val stale = postEdit(session, typeEditBody(target.labelId, target.labelType, other, target.severity, target.tags))
      status(stale) mustBe CONFLICT
      (contentAsJson(stale) \ "label_type").as[String] mustBe "Signal"
      fullState(target.labelId)._1 mustBe "Signal"

      // Back to where it started: the edit folds into the row the first change opened, which nets out, and the old
      // votes count again.
      status(
        postEdit(session, typeEditBody(target.labelId, "Signal", target.labelType, target.severity, target.tags))
      ) mustBe OK
      fullState(target.labelId) mustBe before
      typeEditsBy(target.labelId, userId) mustBe empty
    }
  }

  "POST /labelmap/validate with a new_label_type" should {
    "record an admin's Agree as a vote on the new type with the change linked to it, and unwind both on undo" in {
      val target               = pickTypeChangeLabel()
      val other                = otherSeverityType(target.labelType)
      val (userId, _, session) = signUpFreshUser()
      grantAdmin(userId)
      val before = fullState(target.labelId)

      val agreed = postPopupVote(session, popupVoteBody(target, "Agree", target.severity, undone = false, Some(other)))
      status(agreed) mustBe OK
      val afterChange = fullState(target.labelId)
      afterChange._1 mustBe other
      // The changer's Agree is the only vote on the new type: one agree, and the label is back in the queue.
      (afterChange._4, afterChange._5, afterChange._6, afterChange._7) mustBe ((1, 0, 0, Some(true)))
      votesBy(target.labelId, userId) mustBe Seq((other, "Agree"))
      val edits = editsBy(target.labelId, userId)
      edits.map(_._5.isDefined) mustBe Seq(true)
      typeEditsBy(target.labelId, userId).map(e => (e._1, e._2)) mustBe Seq((target.labelType, other))

      // A popup still showing the old type is told to reload rather than filing a vote on a type the label lost.
      val staleVote = postPopupVote(
        session,
        popupVoteBody(target, "Agree", target.severity, undone = false)
          + ("label_type" -> Json.toJson(target.labelType))
      )
      status(staleVote) mustBe CONFLICT
      (contentAsJson(staleVote) \ "label_type").as[String] mustBe other
      votesBy(target.labelId, userId) mustBe Seq((other, "Agree"))

      // Undoing the vote unwinds the type change with it.
      status(
        postPopupVote(session, popupVoteBody(target, "Agree", target.severity, undone = true, Some(other)))
      ) mustBe OK
      fullState(target.labelId) mustBe before
      votesBy(target.labelId, userId) mustBe empty
      typeEditsBy(target.labelId, userId) mustBe empty
    }

    "keep the type change when the changer later votes on the label again, rather than on an undo" in {
      val target               = pickTypeChangeLabel()
      val other                = otherSeverityType(target.labelType)
      val (userId, _, session) = signUpFreshUser()
      grantAdmin(userId)

      status(postPopupVote(session, popupVoteBody(target, "Agree", target.severity, undone = false, Some(other))))
        .mustBe(OK)
      fullState(target.labelId)._1 mustBe other

      // The re-typed label is served again, and this validator votes on it a second time. That replaces their verdict
      // and nothing else: they are not taking back what they said the type was, and reverting it here would leave the
      // vote they just cast naming a type the label no longer has.
      val revote =
        postPopupVote(session, popupVoteBody(target.copy(labelType = other), "Agree", target.severity, undone = false))
      status(revote) mustBe OK
      fullState(target.labelId)._1 mustBe other
      votesBy(target.labelId, userId) mustBe Seq((other, "Agree"))
      // The change stays on record, no longer tied to the vote that has been replaced.
      typeEditsBy(target.labelId, userId).map(e => (e._1, e._2)) mustBe Seq((target.labelType, other))
      editsBy(target.labelId, userId).map(_._5.isDefined) mustBe Seq(false)
    }
  }

  "POST /labelmap/validate" should {
    "record a change carried by an Agree as an edit linked to the vote, separate from a standalone edit, and unwind it on undo" in {
      val target               = pickLabel()
      val (userId, _, session) = signUpFreshUser()
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
