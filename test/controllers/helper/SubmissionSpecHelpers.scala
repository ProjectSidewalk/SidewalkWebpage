package controllers.helper

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.db.slick.DatabaseConfigProvider
import play.api.libs.json.{JsValue, Json}
import play.api.mvc.Cookie
import play.api.test.FakeRequest
import play.api.test.Helpers._
import slick.basic.DatabaseConfig

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Shared plumbing for the submission-endpoint specs (#4777): anonymous session minting, direct DB reads for row
 * assertions, and extraction of the JSON that the tool pages embed in their inline bootstrap script.
 */
trait SubmissionSpecHelpers { this: PlaySpec with GuiceOneAppPerSuite =>

  protected lazy val dbConfig: DatabaseConfig[MyPostgresProfile] =
    app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  /** Runs a DB action and waits for the result — for arrange/assert steps, never for the endpoint under test. */
  protected def runDb[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 30.seconds)

  /** Mints a fresh anonymous session (a distinct persistent user per call) and returns its cookies. */
  protected def freshAnonSession(): Seq[Cookie] = {
    val resp = route(app, FakeRequest(GET, "/anonSignUp?url=%2F")).get
    status(resp) mustBe SEE_OTHER
    cookies(resp).toSeq
  }

  /**
   * Extracts the JSON assigned to `lhs` in a page's inline bootstrap script — how the Explore and Validate views hand
   * their mission/task/label data to the frontend (e.g. `mainParam.mission = {...};`). Each such assignment is
   * emitted on a single line, which is what makes it parseable here.
   *
   * @param html Rendered page body to search.
   * @param lhs  The assignment target, e.g. `"mainParam.task"` or `"param.labelList"`.
   * @return     The parsed right-hand side, or None when the page doesn't assign `lhs` (multi-line object literals
   *             authored directly in the template are skipped by design).
   */
  protected def embeddedPageJson(html: String, lhs: String): Option[JsValue] =
    html.linesIterator.map(_.trim).collectFirst {
      case line if line.startsWith(s"$lhs = ") && line.endsWith(";") =>
        Json.parse(line.stripPrefix(s"$lhs = ").stripSuffix(";"))
    }
}
