package modules

import play.api.Configuration

/** Picks each city's database pool size, since every city's app shares one Postgres connection limit (#4563). */
object CityDbPool {
  private val slickDb = "slick.dbs.default.db"

  /** @return The `db-pool` block for a city: the small one if it is set to true under `city-params.low-traffic`. */
  private def tier(config: Configuration, cityId: String): String =
    if (config.getOptional[Boolean](s"city-params.low-traffic.$cityId").contains(true)) "db-pool.low-traffic"
    else "db-pool.default"

  def maxConnections(config: Configuration, cityId: String): Int =
    config.get[Int](s"${tier(config, cityId)}.max-connections")

  /** @return `config`, with the pool sizes for its own city swapped in. */
  def applyTo(config: Configuration): Configuration = config.getOptional[String]("city-id").fold(config) { cityId =>
    val max: Int = maxConnections(config, cityId)
    // Slick needs one thread per connection, so the two always move together.
    Configuration(
      s"$slickDb.numThreads"     -> max,
      s"$slickDb.maxConnections" -> max,
      s"$slickDb.minConnections" -> config.get[Int](s"${tier(config, cityId)}.min-connections")
    ).withFallback(config)
  }
}
