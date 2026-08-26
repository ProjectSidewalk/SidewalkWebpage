package service

import models.audit.AuditTaskTable
import models.pano.PanoSource
import models.street.{StreetImageryTable, StreetReopenCandidateTable}
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.ws.WSClient
import play.api.{Application, Configuration}
import service.ImageryFreshnessService.{MissingImageryCredentialException, PollResult}
import service.PanoDataService.ImageryCheckResult

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

/**
 * How the nightly imagery jobs report an outcome, which is what the Health panel reads (#4928).
 *
 * The distinction under test is between a job that had nothing to do and a job that *could not run*. Both cover zero
 * streets and produce an identical-looking log line, but only one is healthy — and recording the second as a success
 * is how a rotated-out API key ends the #4384 re-audit signal behind a green badge that never goes amber.
 *
 * Requires a Postgres database (the app boots to supply the service's collaborators); the poll itself makes no
 * provider calls in these cases, since it fails or short-circuits before reaching one.
 */
class ImageryPollOutcomeSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  private val configService = app.injector.instanceOf[ConfigService]
  private val baseConfig    = app.injector.instanceOf[Configuration]

  /** The config key this city's provider needs before it can poll at all. */
  private val credentialKey: Option[String] = configService.getPanoSource match {
    case PanoSource.Gsv       => Some("google-maps-api-key")
    case PanoSource.Mapillary => Some("mapillary-access-token")
    case _                    => None
  }

  /** The real service, rebuilt against a configuration with one key removed. */
  private def serviceWithout(key: String): ImageryFreshnessService = {
    new ImageryFreshnessServiceImpl(
      app.injector.instanceOf[DatabaseConfigProvider],
      Configuration(baseConfig.underlying.withoutPath(key)),
      app.injector.instanceOf[WSClient],
      configService,
      app.injector.instanceOf[PanoDataService],
      app.injector.instanceOf[StreetImageryTable],
      app.injector.instanceOf[StreetReopenCandidateTable],
      app.injector.instanceOf[AuditTaskTable],
      app.injector.instanceOf[ExecutionContext]
    )
  }

  "pollImageryAges" should {
    "fail rather than report success when its provider's credential is missing" in {
      assume(credentialKey.isDefined, s"${configService.getPanoSource} has no imagery-age credential to remove")

      // A success here is what makes the run row say `succeeded` with `streets_polled: 0`, which then satisfies the
      // overdue check forever. The failure is the whole point: it is the only thing that surfaces a rotated key.
      val thrown = the[MissingImageryCredentialException] thrownBy {
        await(serviceWithout(credentialKey.get).pollImageryAges())
      }
      thrown.getMessage must include(credentialKey.get)
    }
  }

  "PollResult.notPolled" should {
    "describe a poll that covered nothing, and say why" in {
      // The other zero-street case: a provider with no age query to make. Deliberately still a success — that is
      // settled configuration rather than a fault, and alarming on it nightly forever would be noise.
      val result = PollResult.notPolled("Imagery-age polling isn't supported for provider Infra3d; skipping.")
      result.streetsSelected mustBe 0
      result.streetsPolled mustBe 0
      result.streetsSkipped mustBe 0
      result.provider mustBe None
      result.notPolledReason mustBe defined
      result.summary mustBe "Imagery-age polling isn't supported for provider Infra3d; skipping."
    }
  }

  "PollResult.summary" should {
    "account for the regained-imagery rotation as well as the main batch" in {
      // The two rotations are separately sized and separately starved, so one line reporting only the main batch
      // would read as a healthy night while the #4929 re-check silently covered nothing.
      val result = PollResult(Some("GSV"), 500, 480, 20, None, 25, 24, 2)
      result.summary mustBe ("GSV imagery-age poll: 480 streets updated, 20 skipped (of 500 selected); "
        + "24 of 25 no-imagery streets re-checked, 2 reopen candidate(s) found.")
    }
  }

  "PollResult.runDetails" should {
    "record every count under the key the Imagery page's run history reads it back by" in {
      // Defined on the result rather than at the actor's call site, so the writer and the reader cannot fork. The
      // literal key names are the contract: a rename on one side alone reports zeros forever, looking like a quiet
      // night rather than a broken pipeline.
      val details = PollResult(Some("GSV"), 500, 480, 20, None, 25, 24, 2).runDetails

      (details \ "provider").as[String] mustBe "GSV"
      (details \ "streets_selected").as[Int] mustBe 500
      (details \ "streets_polled").as[Int] mustBe 480
      (details \ "streets_skipped").as[Int] mustBe 20
      (details \ "no_imagery_streets_selected").as[Int] mustBe 25
      (details \ "no_imagery_streets_polled").as[Int] mustBe 24
      (details \ "reopen_candidates_found").as[Int] mustBe 2
    }

    "carry the reason a poll covered nothing, so a skipped night isn't recorded as a zero-count one" in {
      val details =
        PollResult.notPolled("Imagery-age polling isn't supported for provider Infra3d; skipping.").runDetails
      (details \ "not_polled_reason").as[String] must include("Infra3d")
      (details \ "provider").asOpt[String] mustBe None
    }
  }

  "ImageryCheckResult" should {
    "total the three outcomes it distinguishes" in {
      // `errors` is the signal worth watching: a key at its quota turns every check inconclusive, which leaves the
      // expired counts looking reassuringly quiet while the sweep has stopped learning anything.
      val result = ImageryCheckResult(stillThere = 7, gone = 2, errors = 1)
      result.checked mustBe 10
      result.summary mustBe "Not expired: 7. Expired: 2. Errors: 1."
    }

    "record one shape for both the nightly sweep and the hand-trigger" in {
      // Defined on the result rather than at each call site, so the two callers can't fork the recorded shape.
      val details = ImageryCheckResult(stillThere = 7, gone = 2, errors = 1).runDetails
      (details \ "panos_checked").as[Int] mustBe 10
      (details \ "still_there").as[Int] mustBe 7
      (details \ "gone").as[Int] mustBe 2
      (details \ "errors").as[Int] mustBe 1
    }
  }
}
