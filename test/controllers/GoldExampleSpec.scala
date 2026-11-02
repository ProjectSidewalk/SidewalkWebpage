package controllers

import controllers.helper.SubmissionSpecHelpers
import models.label.LabelType
import models.pano.PanoSource
import models.user.Role
import models.utils.MyPostgresProfile.api.*
import models.validation.{GoldExampleTable, ValidationReason}
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsNull, JsObject, JsValue, Json}
import play.api.mvc.Cookie
import play.api.test.CSRFTokenHelper.*
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import service.ConfigService
import util.{RoleSession, SidewalkSpec}

import java.time.OffsetDateTime

/**
 * Functional tests for known-answer examples (#1445): a pinned label rides a new validator's mission with its reason,
 * the vote on it is filed as an answer and never as a validation, the first answer stands, and admins are neither
 * quizzed nor able to pin what can't teach.
 *
 * Follows the real client bootstrap, as ValidateSubmissionSpec does: the page asks POST /validationTask/mission for
 * its mission, and the spec votes on the example in that real batch. One label of every primary type is pinned, since
 * the mission's type is the lottery's to choose. The pins and every row written under the suite's users are removed
 * in `afterAll`.
 *
 * Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class GoldExampleSpec
    extends SidewalkSpec
    with BeforeAndAfterAll
    with SubmissionSpecHelpers
    with RoleSession
    with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  private val goldExampleTable   = app.injector.instanceOf[GoldExampleTable]
  private val viewer: PanoSource = app.injector.instanceOf[ConfigService].getPanoSource

  /** Deleted in `afterAll`, with everything written under them. */
  private var createdUserIds: Set[String] = Set.empty

  /** By type; unpinned in `afterAll`. */
  private var pinned: Map[LabelType, Int] = Map.empty

  /** The first Disagree reason each type offers, which is what the pin teaches. */
  private def reasonFor(labelType: LabelType): ValidationReason =
    ValidationReason.offered(labelType, models.validation.ValidationOption.Disagree).head

  /**
   * A label of the type that plain Validate could serve: not deleted or tutorial, its labeler not excluded, on a
   * pano of the page's source that is unexpired and was checked recently enough that the imagery check answers
   * from the row. None when the schema has no such label of that type.
   */
  private def servableLabel(labelType: LabelType): Option[Int] = run(
    sql"""SELECT label.label_id
          FROM label
          INNER JOIN label_point ON label_point.label_id = label.label_id
          INNER JOIN pano_data ON pano_data.pano_id = label.pano_id
          INNER JOIN user_stat ON user_stat.user_id = label.user_id
          INNER JOIN street_edge_region ON street_edge_region.street_edge_id = label.street_edge_id
          WHERE label.label_type = ${labelType.name}::label_type
            AND NOT label.deleted AND NOT label.tutorial AND NOT user_stat.excluded
            AND label_point.lat IS NOT NULL AND label_point.lng IS NOT NULL
            AND pano_data.source = $viewer AND NOT pano_data.expired
            AND pano_data.last_checked >= now() - INTERVAL '6 days'
            AND label.street_edge_id <> (SELECT config.tutorial_street_edge_id FROM config)
          ORDER BY label.label_id
          LIMIT 1""".as[Int].headOption
  )

  override def beforeAll(): Unit = {
    super.beforeAll()
    pinned = LabelType.primaryValidateLabelTypes.flatMap { lt =>
      servableLabel(lt).map { id =>
        run(goldExampleTable.pin(id, reasonFor(lt), adminUserId))
        lt -> id
      }
    }.toMap
  }

  override def afterAll(): Unit = {
    try {
      createdUserIds.foreach { uId =>
        val _ = run(
          DBIO.seq(
            sqlu"DELETE FROM gold_example_response WHERE user_id = $uId",
            sqlu"DELETE FROM validation_task_comment WHERE user_id = $uId",
            sqlu"DELETE FROM label_validation WHERE user_id = $uId",
            sqlu"DELETE FROM validation_task_environment WHERE mission_id IN (SELECT mission_id FROM mission WHERE user_id = $uId)",
            sqlu"DELETE FROM mission WHERE user_id = $uId"
          )
        )
      }
      pinned.values.foreach(id => run(goldExampleTable.unpin(id)))
    } finally super.afterAll()
  }

  private lazy val adminCookies: Seq[Cookie]   = sessionAs(Role.Administrator)
  private lazy val adminUserId: String         = userIdOf(adminCookies)
  private lazy val visitorCookies: Seq[Cookie] = sessionAs(Role.Registered)

  /** What the server assigns a fresh session, with the user's id for row assertions. */
  private case class Bootstrap(userId: String, missionId: Int, mission: JsObject, labels: Seq[JsObject])

  private def bootstrap(session: Seq[Cookie]): Bootstrap = {
    if (pinned.isEmpty) cancel("No servable label of any primary type in the connected schema; nothing to pin.")
    val resp = ValidateSpecSupport.postMission(app, ValidateSpecSupport.CrowdParams, session)
    status(resp) mustBe OK
    val body    = contentAsJson(resp)
    val mission = (body \ "mission")
      .asOpt[JsObject]
      .getOrElse(cancel("No validation mission available (needs >= 10 validatable labels of one type)."))
    val labels    = (body \ "labels").as[Seq[JsObject]]
    val missionId = (mission \ "mission_id").as[Int]
    val userId    = run(sql"SELECT user_id FROM mission WHERE mission_id = $missionId".as[String]).head
    createdUserIds += userId
    Bootstrap(userId, missionId, mission, labels)
  }

  private def goldReason(label: JsObject): Option[String] = (label \ "gold_reason").asOpt[String]

  /** A vote as the Validate frontend submits one, with no severity or tag change. */
  private def validationJson(
      label: JsObject,
      missionId: Int,
      result: String,
      undone: Boolean = false,
      redone: Boolean = false
  ): JsObject = {
    val now = OffsetDateTime.now
    Json.obj(
      "comment"           -> JsNull,
      "label_id"          -> (label \ "label_id").as[Int],
      "mission_id"        -> missionId,
      "validation_result" -> result,
      "severity"          -> (label \ "severity").asOpt[Int],
      "tags"              -> (label \ "tags").as[JsValue],
      "canvas_x"          -> 355,
      "canvas_y"          -> 242,
      "heading"           -> (label \ "heading").as[Double],
      "pitch"             -> (label \ "pitch").as[Double],
      "zoom"              -> (label \ "zoom").as[Double],
      "canvas_height"     -> 440,
      "canvas_width"      -> 720,
      "start_timestamp"   -> now,
      "end_timestamp"     -> now,
      "source"            -> "Validate",
      "undone"            -> undone,
      "redone"            -> redone,
      "viewer_type"       -> "Default",
      "label_type"        -> (label \ "label_type").as[String],
      "new_label_type"    -> JsNull
    )
  }

  private def postVote(session: Seq[Cookie], b: Bootstrap, validation: JsObject, progress: Int) = {
    val now     = OffsetDateTime.now
    val payload = Json.obj(
      "interactions"     -> Json.arr(),
      "environment"      -> Json.obj("mission_id" -> b.missionId, "language" -> "en", "css_zoom" -> 100),
      "validations"      -> Json.arr(validation),
      "mission_progress" -> Json.obj(
        "mission_id"      -> b.missionId,
        "mission_type"    -> (b.mission \ "mission_type").as[String],
        "labels_progress" -> progress,
        "labels_total"    -> (b.mission \ "labels_validated").as[Int],
        "label_type"      -> (b.mission \ "label_type").as[String],
        "completed"       -> false,
        "skipped"         -> false
      ),
      "validate_params" -> ValidateSpecSupport.CrowdParams,
      "pano_histories"  -> Json.arr(),
      "source"          -> "Validate",
      "timestamp"       -> now
    )
    route(app, FakeRequest(POST, "/validationTask").withCookies(session*).withJsonBody(payload).withCSRFToken).get
  }

  private def answer(labelId: Int, userId: String): Option[(Option[String], Int)] = run(
    sql"""SELECT validation_result::text, mission_id FROM gold_example_response
          WHERE label_id = $labelId AND user_id = $userId""".as[(Option[String], Int)]
  ).headOption

  private def voteRows(labelId: Int, userId: String): Int =
    run(sql"SELECT count(*) FROM label_validation WHERE label_id = $labelId AND user_id = $userId".as[Int]).head

  private def counts(labelId: Int): (Int, Int, Int) =
    run(
      sql"SELECT agree_count, disagree_count, unsure_count FROM label WHERE label_id = $labelId".as[(Int, Int, Int)]
    ).head

  "a new validator's first mission" should {
    "carry one pinned example of the mission's type, after the first label, and file the vote on it as an answer" in {
      val session = freshAnonSession()
      val b       = bootstrap(session)
      val lt      = LabelType.withName((b.mission \ "label_type").as[String])
      val goldId  = pinned.getOrElse(lt, cancel(s"no servable $lt label to pin in this schema"))

      val examples = b.labels.filter(l => goldReason(l).isDefined)
      examples.map(l => (l \ "label_id").as[Int]) mustBe Seq(goldId)
      goldReason(examples.head) mustBe Some(reasonFor(lt).name)
      (b.labels.head \ "label_id").as[Int] must not be goldId
      // The serve is on record before any vote, keyed to this mission.
      answer(goldId, b.userId) mustBe Some((None, b.missionId))

      val before = counts(goldId)
      status(postVote(session, b, validationJson(examples.head, b.missionId, "Agree"), 1)) mustBe OK
      answer(goldId, b.userId) mustBe Some((Some("Agree"), b.missionId))
      voteRows(goldId, b.userId) mustBe 0
      counts(goldId) mustBe before

      // The first answer stands through an undo and a re-vote: the explanation gave the answer away.
      status(postVote(session, b, validationJson(examples.head, b.missionId, "Agree", undone = true), 0)) mustBe OK
      answer(goldId, b.userId) mustBe Some((Some("Agree"), b.missionId))
      status(postVote(session, b, validationJson(examples.head, b.missionId, "Disagree", redone = true), 1)) mustBe OK
      answer(goldId, b.userId) mustBe Some((Some("Agree"), b.missionId))
      voteRows(goldId, b.userId) mustBe 0
      run(goldExampleTable.answeredCount(b.userId)) mustBe 1
    }

    "not quiz an admin, who pins the examples" in {
      val b = bootstrap(adminCookies)
      b.labels.filter(l => goldReason(l).isDefined) mustBe empty
    }
  }

  "the admin endpoints" should {
    "refuse a signed-in visitor" in {
      status(route(app, FakeRequest(GET, "/adminapi/goldExamples").withCookies(visitorCookies*)).get) mustBe FORBIDDEN
    }

    "list the pinned examples with the reason each teaches" in {
      val resp = route(app, FakeRequest(GET, "/adminapi/goldExamples").withCookies(adminCookies*)).get
      status(resp) mustBe OK
      val rows = (contentAsJson(resp) \ "gold_examples").as[Seq[JsObject]]
      pinned.foreach { case (lt, id) =>
        val row = rows.find(r => (r \ "label_id").as[Int] == id).getOrElse(fail(s"pinned label $id missing"))
        (row \ "label_type").as[String] mustBe lt.name
        (row \ "reason").as[String] mustBe reasonFor(lt).name
      }
    }

    "refuse a reason the label's type doesn't offer for a Disagree" in {
      val (lt, id)     = pinned.headOption.getOrElse(cancel("nothing pinned"))
      val unsureReason = ValidationReason.offered(lt, models.validation.ValidationOption.Unsure).head
      val resp         = route(
        app,
        FakeRequest(POST, "/adminapi/goldExamples")
          .withCookies(adminCookies*)
          .withJsonBody(Json.obj("label_id" -> id, "reason" -> unsureReason.name))
          .withCSRFToken
      ).get
      status(resp) mustBe BAD_REQUEST
      (contentAsJson(resp) \ "error").as[String] mustBe "reason_not_offered"
      // The pin is as it was.
      run(goldExampleTable.find(id)).map(_.reason) mustBe Some(reasonFor(lt))
    }

    "unpin a label and 404 a second removal" in {
      val (lt, id) = pinned.headOption.getOrElse(cancel("nothing pinned"))
      status(
        route(app, FakeRequest(DELETE, s"/adminapi/goldExamples/$id").withCookies(adminCookies*).withCSRFToken).get
      ) mustBe OK
      run(goldExampleTable.find(id)) mustBe None
      status(
        route(app, FakeRequest(DELETE, s"/adminapi/goldExamples/$id").withCookies(adminCookies*).withCSRFToken).get
      ) mustBe NOT_FOUND
      // Put back for the other tests, and for afterAll's own unpin.
      run(goldExampleTable.pin(id, reasonFor(lt), adminUserId))
    }
  }
}
