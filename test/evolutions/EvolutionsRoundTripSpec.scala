package evolutions

import org.scalatestplus.play.PlaySpec
import play.api.db.Databases
import play.api.db.evolutions.Evolutions

/**
 * Deterministic guard that the committed Play evolutions apply, reverse, and re-apply cleanly (up -> down -> up),
 * independent of any seeded city data or API behavior. Catches the highest-blast-radius class of schema bug: a
 * malformed Up (e.g. evolution 325's stray semicolon inside a `--` comment, which Play's parser split on, see
 * #4335 / #4351) or a Down that doesn't reverse its Up.
 *
 * Connection details come from the environment so CI can point this at a throwaway schema (see the `evolutions` job
 * in .github/workflows/ci.yml): the URL's `currentSchema` puts the auto-created `play_evolutions` bookkeeping table
 * and every unqualified object into an isolated schema, so applying all evolutions from scratch — and dropping them
 * again on `down` — never touches the seeded city schemas. (`sidewalk_login`, the `sidewalk` role, and PostGIS still
 * need to exist, which the project's db image provides; a handful of evolutions reference them by name.)
 */
class EvolutionsRoundTripSpec extends PlaySpec {

  "The committed Play evolutions" should {
    "apply, reverse, and re-apply cleanly (up -> down -> up)" in {
      Databases.withDatabase(
        driver = "org.postgresql.Driver",
        url = sys.env.getOrElse("EVOLUTIONS_DB_URL", "jdbc:postgresql://localhost:5432/sidewalk"),
        config = Map(
          "username" -> sys.env.getOrElse("EVOLUTIONS_DB_USER", "sidewalk"),
          "password" -> sys.env.getOrElse("EVOLUTIONS_DB_PASSWORD", "sidewalk")
        )
      ) { database =>
        // Each call throws if any evolution in the sequence fails to apply, so reaching the end means the full
        // forward/back/forward cycle succeeded.
        Evolutions.applyEvolutions(database)
        Evolutions.cleanupEvolutions(database)
        Evolutions.applyEvolutions(database)
      }
    }
  }
}
