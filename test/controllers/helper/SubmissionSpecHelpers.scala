package controllers.helper

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._
import util.{AnonSession, RolledBackDb}

import scala.concurrent.duration._
import scala.util.Try

/**
 * Page-bootstrap plumbing for the submission-endpoint specs (#4777).
 *
 * Pulls in the shared DB access ([[RolledBackDb.run]]) and session minting ([[AnonSession.freshAnonSession]]), and
 * adds what is specific to these specs: reading the JSON that the tool pages embed in their inline bootstrap script,
 * and probing for tables the dev-DB dumps may not carry.
 */
trait SubmissionSpecHelpers extends RolledBackDb with AnonSession { this: PlaySpec with GuiceOneAppPerSuite =>

  /** Arrange/assert queries only, never the endpoint under test; 30s is plenty for those. */
  override protected def dbTimeout: FiniteDuration = 30.seconds

  /**
   * Extracts the JSON assigned to `lhs` in a page's inline bootstrap script — how the Explore and Validate views hand
   * their mission/task/label data to the frontend (e.g. `mainParam.mission = {...};`). Each such assignment is
   * emitted on a single line, which is what makes it parseable here.
   *
   * @param html Rendered page body to search.
   * @param lhs  The assignment target, e.g. `"mainParam.task"` or `"param.labelList"`.
   * @return     The parsed right-hand side of the first assignment to `lhs` that holds JSON, or None when the page has
   *             no such assignment. A matched line whose right-hand side isn't JSON (a trailing comment, a JS
   *             expression) is passed over rather than raised, since the prefix match alone can't tell the two apart.
   */
  protected def embeddedPageJson(html: String, lhs: String): Option[JsValue] =
    html.linesIterator
      .map(_.trim)
      .collect {
        case line if line.startsWith(s"$lhs = ") && line.endsWith(";") =>
          Try(Json.parse(line.stripPrefix(s"$lhs = ").stripSuffix(";"))).toOption
      }
      .collectFirst { case Some(json) => json }

  /**
   * Whether a table exists in the connected schema.
   *
   * The two interaction logs (`audit_task_interaction`, `validation_task_interaction`) are omitted from the dev-DB
   * dumps that seed local development, so a spec asserting on them has to check first — an absent relation raises a
   * Postgres error rather than returning an empty result.
   *
   * @param tableName Unqualified table name, resolved against the connection's search_path.
   * @return          True when the relation is visible to this connection.
   */
  protected def tableExists(tableName: String): Boolean =
    run(sql"SELECT to_regclass($tableName) IS NOT NULL".as[Boolean]).head

  /**
   * Loads /explore for the session and pulls the assigned mission/task out of the page's bootstrap script.
   *
   * Cancels rather than fails when the connected schema can't produce an assignment, since that is a property of the
   * seed data and not of the code under test. A /explore that answers anything but 200 on a schema that *can* assign
   * is a real failure and is left to fail.
   *
   * @param session Cookies from an anonymous session.
   * @return        The mission/task the server assigned, in the shape a submission payload is built from.
   */
  protected def exploreBootstrap(session: Seq[Cookie]): ExploreBootstrap = {
    // A street alone isn't enough to serve /explore: region assignment needs a region that holds one, and the CI
    // template ships the tutorial street (id 1) with zero regions, so a plain street count never trips. Without a
    // region, /explore 500s on an unhandled empty Option rather than answering (#4748) — cancel instead of failing on
    // that known gap, so a 500 with assignable data still fails below.
    val assignableStreets = run(sql"""SELECT count(*)
                                      FROM street_edge_region
                                      INNER JOIN region ON street_edge_region.region_id = region.region_id
                                      WHERE region.deleted = FALSE""".as[Int]).head
    if (assignableStreets == 0) cancel("No region holds a street in the connected schema; /explore can't assign one.")

    val resp = route(app, FakeRequest(GET, "/explore").withCookies(session: _*)).get
    status(resp) mustBe OK
    val html = contentAsString(resp)
    val task = embeddedPageJson(html, "mainParam.task")
      .getOrElse(cancel("No task in the explore bootstrap (the user's assigned region is fully audited)."))
    val mission = embeddedPageJson(html, "mainParam.mission")
      .getOrElse(fail("No mission in the explore bootstrap."))
    val regionId = embeddedPageJson(html, "mainParam.regionId")
      .map(_.as[Int])
      .getOrElse(fail("No regionId in the explore bootstrap."))
    val missionId = (mission \ "mission_id").as[Int]
    // The assigned mission row carries the session user's id, so it resolves the anon user for row assertions.
    val userId = run(sql"SELECT user_id FROM mission WHERE mission_id = $missionId".as[String]).head
    val props  = (task \ "properties").as[JsObject]
    ExploreBootstrap(
      userId,
      regionId,
      missionId,
      (mission \ "mission_type").as[String],
      (props \ "street_edge_id").as[Int],
      (props \ "current_lat").as[Double],
      (props \ "current_lng").as[Double],
      (props \ "task_start").as[String],
      (props \ "start_point_reversed").as[Boolean],
      // Echoed back on submission exactly as the client does. A task the user already started carries the id of its
      // existing audit_task row, and sending it is what routes the write to the update path instead of a second insert.
      (props \ "audit_task_id").asOpt[Int]
    )
  }
}

/** The explore-page values a submission payload is built from, as the real client reads them. */
case class ExploreBootstrap(
    userId: String,
    regionId: Int,
    missionId: Int,
    missionType: String,
    streetEdgeId: Int,
    currentLat: Double,
    currentLng: Double,
    taskStart: String,
    startPointReversed: Boolean,
    auditTaskId: Option[Int]
)
