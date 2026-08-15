package controllers.helper

import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.libs.json.{JsValue, Json}
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
}
