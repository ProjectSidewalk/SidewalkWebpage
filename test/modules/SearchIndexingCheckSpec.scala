package modules

import com.typesafe.config.ConfigFactory
import modules.SearchIndexingCheck.{invalidStatuses, verdict}
import org.scalatestplus.play.PlaySpec
import play.api.Configuration

/**
 * The config contract behind search indexing (#5120): once the vhost `X-Robots-Tag` header is gone,
 * `city-params.status.<cityId>` alone decides whether a deployment is indexed, and an unrecognised value fails
 * silently toward "private" — a launched city drops out of the index with nothing raised anywhere.
 *
 * Pure logic — no app boot and no database.
 */
class SearchIndexingCheckSpec extends PlaySpec {

  /** A minimal cityparams shape carrying the three keys the indexing predicate reads. */
  private def configFor(statuses: (String, String)*)(current: String, envType: String = "prod"): Configuration =
    Configuration.from(
      Map[String, Any](
        "city-id"              -> current,
        "environment-type"     -> envType,
        "city-params.city-ids" -> statuses.map(_._1)
      ) ++
        statuses.map { case (id, status) => s"city-params.status.$id" -> status } ++
        statuses.map { case (id, _) => s"city-params.pano-viewer-type.$id" -> "gsv" }
    )

  "invalidStatuses" should {
    "accept the two valid values" in {
      invalidStatuses(configFor("seattle-wa" -> "public", "auckland" -> "private")("seattle-wa")) mustBe empty
    }

    "flag a case or whitespace variant, which reads as private and silently un-indexes a launched city" in {
      Seq("Public", "PUBLIC", " public", "public ", "publik", "").foreach { bad =>
        withClue(s"'$bad': ") {
          invalidStatuses(configFor("seattle-wa" -> bad)("seattle-wa")) mustBe
            Seq(SearchIndexingCheck.InvalidStatus("seattle-wa", s""""$bad""""))
        }
      }
    }

    "flag a missing status rather than throwing, so one bad entry can't abort the sweep" in {
      val config = Configuration.from(
        Map(
          "city-id"                                 -> "seattle-wa",
          "environment-type"                        -> "prod",
          "city-params.city-ids"                    -> Seq("seattle-wa", "newcity"),
          "city-params.status.seattle-wa"           -> "public",
          "city-params.pano-viewer-type.seattle-wa" -> "gsv"
        )
      )
      invalidStatuses(config) mustBe Seq(SearchIndexingCheck.InvalidStatus("newcity", "<missing>"))
    }

    "report every offender, not just the first" in {
      invalidStatuses(configFor("a" -> "Public", "b" -> "private", "c" -> "yes")("b")).map(_.cityId) mustBe
        Seq("a", "c")
    }

    "pass against the bundled cityparams, so the repo's own status block stays lint-checked" in {
      invalidStatuses(Configuration(ConfigFactory.load())) mustBe empty
    }
  }

  "verdict" should {
    "report INDEXABLE only for a public, non-walled prod city, naming all three inputs" in {
      val line = verdict(configFor("seattle-wa" -> "public")("seattle-wa"))
      line must include("INDEXABLE")
      line must include("environment-type=prod")
      line must include("status=public")
      line must include("pano-viewer-type=gsv")
    }

    "report NOT indexable for a private city" in {
      verdict(configFor("auckland" -> "private")("auckland")) must include("NOT indexable")
    }

    "report NOT indexable on a non-prod stage" in {
      verdict(configFor("seattle-wa" -> "public")("seattle-wa", envType = "test")) must include("NOT indexable")
    }

    "count the public cities, so a substitution flipping several at once is visible" in {
      // The Taiwan deployments read ${city-params.status.taipei}, so editing one entry can move six.
      verdict(configFor("a" -> "public", "b" -> "public", "c" -> "private")("a")) must include("2 of 3")
    }

    "degrade rather than throw when a city has no pano-viewer-type, so a config gap can't fail the boot" in {
      val config = Configuration.from(
        Map[String, Any](
          "city-id"                    -> "newcity",
          "environment-type"           -> "prod",
          "city-params.city-ids"       -> Seq("newcity"),
          "city-params.status.newcity" -> "public"
        )
      )
      verdict(config) must include("pano-viewer-type=<missing>")
    }

    "name a missing status rather than throwing" in {
      val config = Configuration.from(
        Map(
          "city-id"                              -> "newcity",
          "environment-type"                     -> "prod",
          "city-params.city-ids"                 -> Seq("newcity"),
          "city-params.pano-viewer-type.newcity" -> "gsv"
        )
      )
      val line = verdict(config)
      line must include("status=<missing>")
      line must include("NOT indexable")
    }
  }
}

/**
 * That the check is wired into boot. The logic above is worthless if `StartupChecksModule` never constructs it, and
 * nothing would notice: the check's only output is a log line.
 */
class SearchIndexingCheckWiringSpec extends PlaySpec with org.scalatestplus.play.guice.GuiceOneAppPerSuite {

  override def fakeApplication(): play.api.Application =
    new play.api.inject.guice.GuiceApplicationBuilder().disable[modules.ActorModule].build()

  "StartupChecksModule" should {
    "bind SearchIndexingCheck" in {
      app.injector.instanceOf[SearchIndexingCheck] must not be null
    }

    "construct it in Dev mode, where it actually reads config and logs, without failing the boot" in {
      // The suite runs in Mode.Test, which the check skips, so this is the only exercise of the live branch — and a
      // boot check that throws takes the deployment down, far worse than the misconfiguration it reports.
      val devApp = new play.api.inject.guice.GuiceApplicationBuilder()
        .in(play.api.Mode.Dev)
        .disable[modules.ActorModule]
        .build()
      try devApp.injector.instanceOf[SearchIndexingCheck] must not be null
      finally play.api.Play.stop(devApp)
    }
  }
}
