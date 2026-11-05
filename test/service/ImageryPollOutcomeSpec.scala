package service

import models.audit.AuditTaskTable
import models.pano.PanoSource
import models.street.{StreetImageryTable, StreetReopenCandidateTable}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsNull
import play.api.libs.ws.WSClient
import play.api.{Application, Configuration}
import service.ImageryFreshnessService.{MissingImageryCredentialException, PollResult}
import service.PanoDataService.ImageryCheckResult
import util.SidewalkSpec

import scala.concurrent.duration.*
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
class ImageryPollOutcomeSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  private val configService = app.injector.instanceOf[ConfigService]
  private val baseConfig    = app.injector.instanceOf[Configuration]

  /** The config keys this city's provider needs before it can poll at all; GSV takes either key. */
  private val credentialKeys: Seq[String] = configService.getPanoSource match {
    case PanoSource.Gsv       => Seq("google-maps-server-key", "google-maps-api-key")
    case PanoSource.Mapillary => Seq("mapillary-access-token")
    case _                    => Seq.empty
  }

  /** The real service, rebuilt against a configuration with those keys removed. */
  private def serviceWithout(keys: Seq[String]): ImageryFreshnessService = {
    ImageryFreshnessServiceImpl(
      app.injector.instanceOf[DatabaseConfigProvider],
      Configuration(keys.foldLeft(baseConfig.underlying)(_.withoutPath(_))),
      app.injector.instanceOf[WSClient],
      configService,
      app.injector.instanceOf[PanoDataService],
      app.injector.instanceOf[StreetImageryTable],
      app.injector.instanceOf[StreetReopenCandidateTable],
      app.injector.instanceOf[AuditTaskTable]
    )(using app.injector.instanceOf[ExecutionContext])
  }

  /**
   * The real service against the app's configuration with `overrides` layered on top, minus any batch-size override
   * the environment running the suite happens to export, so auto-sizing is what's under test unless a case pins it.
   */
  private def serviceWith(overrides: (String, Any)*): ImageryFreshnessService = {
    ImageryFreshnessServiceImpl(
      app.injector.instanceOf[DatabaseConfigProvider],
      Configuration(overrides*).withFallback(
        Configuration(baseConfig.underlying.withoutPath("street-imagery-poll.batch-size"))
      ),
      app.injector.instanceOf[WSClient],
      configService,
      app.injector.instanceOf[PanoDataService],
      app.injector.instanceOf[StreetImageryTable],
      app.injector.instanceOf[StreetReopenCandidateTable],
      app.injector.instanceOf[AuditTaskTable]
    )(using app.injector.instanceOf[ExecutionContext])
  }

  "pollPlan" should {
    "size the batch from the city's own open-street count when nothing pins it (#5402)" in {
      val plan        = await(serviceWith().pollPlan)
      val openStreets = await(
        app.injector
          .instanceOf[DatabaseConfigProvider]
          .get[models.utils.MyPostgresProfile]
          .db
          .run(app.injector.instanceOf[StreetImageryTable].countStreetsToPoll)
      )
      plan.openStreets mustBe openStreets
      plan.overridden mustBe false
      plan.batchSize mustBe ImageryFreshnessService.batchSizeFor(
        openStreets,
        None,
        baseConfig.get[Int]("street-imagery-poll.pass-nights"),
        baseConfig.get[Int]("street-imagery-poll.min-batch-size"),
        baseConfig.get[Int]("street-imagery-poll.max-batch-size")
      )

      // A one-night pass with bounds out of the way polls exactly the city's open streets, which shows the count --
      // not a bound -- drove the size, whatever the size of the seed.
      val oneNight = await(
        serviceWith(
          "street-imagery-poll.pass-nights"    -> 1,
          "street-imagery-poll.min-batch-size" -> 1,
          "street-imagery-poll.max-batch-size" -> Int.MaxValue
        ).pollPlan
      )
      oneNight.batchSize mustBe math.max(1, openStreets)
      oneNight.passNights mustBe (if (openStreets == 0) 0 else 1)
    }

    "use a pinned batch size verbatim, and say it was pinned" in {
      val plan = await(serviceWith("street-imagery-poll.batch-size" -> "37").pollPlan)
      plan.batchSize mustBe 37
      plan.overridden mustBe true
    }

    "treat an override exported empty as unset" in {
      val plan = await(serviceWith("street-imagery-poll.batch-size" -> " ").pollPlan)
      plan.overridden mustBe false
    }
  }

  "pollImageryAges" should {
    "fail rather than report success when its provider's credential is missing" in {
      assume(credentialKeys.nonEmpty, s"${configService.getPanoSource} has no imagery-age credential to remove")

      // A success here is what makes the run row say `succeeded` with `streets_polled: 0`, which then satisfies the
      // overdue check forever. The failure is the whole point: it is the only thing that surfaces a rotated key.
      val thrown = the[MissingImageryCredentialException] thrownBy {
        await(serviceWithout(credentialKeys).pollImageryAges())
      }
      thrown.getMessage must include(credentialKeys.head)
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

    "record how the batch was sized, so the run history shows the pass length each night ran at (#5402)" in {
      val plan    = ImageryFreshnessService.PollPlan(openStreets = 14037, batchSize = 1003, overridden = false)
      val details = PollResult(Some("GSV"), 1003, 1000, 3, plan = Some(plan)).runDetails
      (details \ "batch_size").as[Int] mustBe 1003
      (details \ "open_streets").as[Int] mustBe 14037
      (details \ "pass_nights").as[Int] mustBe 14
      (details \ "batch_size_overridden").as[Boolean] mustBe false
      PollResult(Some("GSV"), 1003, 1000, 3, plan = Some(plan)).summary must
        endWith("Batch 1003 of 14037 open streets: a full pass every 14 nights.")
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
      val result = ImageryCheckResult(stillThere = 7, gone = 2, errors = 1, reconciled = Some(1))
      result.checked mustBe 10
      // Reconciled rows are healed log entries, not provider answers, so they don't count toward `checked`.
      result.summary mustBe "Not expired: 7. Expired: 2. Errors: 1. Reconciled: 1."
    }

    "record one shape for both the nightly sweep and the hand-trigger" in {
      // Defined on the result rather than at each call site, so the two callers can't fork the recorded shape.
      val details = ImageryCheckResult(stillThere = 7, gone = 2, errors = 1, reconciled = Some(1)).runDetails
      (details \ "panos_checked").as[Int] mustBe 10
      (details \ "still_there").as[Int] mustBe 7
      (details \ "gone").as[Int] mustBe 2
      (details \ "errors").as[Int] mustBe 1
      (details \ "reconciled").as[Int] mustBe 1
    }

    "say the repair could not run rather than reporting it healed nothing" in {
      // The repair is subordinate to the sweep, so its failure leaves the counts standing. Recording that as a 0
      // would file "nothing was wrong" and "we never looked" under the same row, which is the thing a
      // background_job_run row exists to tell apart.
      val failed = ImageryCheckResult(stillThere = 7, gone = 2, errors = 1, reconciled = None)
      failed.summary mustBe "Not expired: 7. Expired: 2. Errors: 1. Reconciled: failed."
      (failed.runDetails \ "reconciled").get mustBe JsNull
      (failed.runDetails \ "panos_checked").as[Int] mustBe 10
    }
  }
}
