package service

import com.typesafe.config.{Config, ConfigFactory}
import org.scalatestplus.play.PlaySpec

import scala.jdk.CollectionConverters._

/**
 * Shape checks on the per-city boolean blocks in `cityparams.conf` that `ConfigServiceImpl.cityFlag` reads.
 *
 * These blocks are deliberately *not* exhaustive: `cityFlag` returns false for a missing key or a missing parent, so a
 * city omitted from a block just gets the default. That default-false design has one failure mode with no other
 * tripwire — a misspelled city id silently reads as "not configured" rather than raising, so e.g. a typo'd entry in
 * `ai-label-submission-enabled` would leave a city gated off with no error anywhere. Play never validates these keys,
 * and the flags are consumed one city at a time on a running deployment, so nothing else would catch it.
 *
 * Pure config parsing — no app boot and no database.
 */
class CityFlagConfigSpec extends PlaySpec {

  /** The `city-params` blocks read through `cityFlag`, i.e. the ones where an unlisted city is legal. */
  private val optionalFlagBlocks =
    Seq("ai-label-submission-enabled", "private-profiles-by-default", "global-leaderboard-excluded")

  private lazy val config: Config       = ConfigFactory.load()
  private lazy val cityIds: Set[String] = config.getStringList("city-params.city-ids").asScala.toSet

  "the per-city flag blocks read through cityFlag" should {
    "key every entry on a configured city id, so a typo can't silently read as the default" in {
      cityIds must not be empty
      optionalFlagBlocks.foreach { block =>
        val path = s"city-params.$block"
        if (config.hasPath(path)) {
          config.getConfig(path).root().keySet().asScala.foreach { cityId =>
            withClue(s"$block.$cityId is not in city-params.city-ids: ") { cityIds must contain(cityId) }
          }
        }
      }
    }

    "hold boolean values, since cityFlag reads them as Boolean and would throw on anything else" in {
      optionalFlagBlocks.foreach { block =>
        val path = s"city-params.$block"
        if (config.hasPath(path)) {
          config.getConfig(path).root().keySet().asScala.foreach { cityId =>
            withClue(s"$block.$cityId: ") { noException must be thrownBy config.getBoolean(s"$path.$cityId") }
          }
        }
      }
    }
  }

  "ai-label-submission-enabled" should {
    // Replacing the old hard-coded `getCityId == "vancouver-wa"` check with this flag (#4760) is only behavior-
    // preserving as long as Vancouver stays listed — dropping the entry would silently close the pilot's gate.
    "keep the vancouver-wa pilot enabled, the city the flag replaced a hard-coded check for (#4760)" in {
      config.getBoolean("city-params.ai-label-submission-enabled.vancouver-wa") mustBe true
    }
  }
}
