package modules

import com.typesafe.config.ConfigFactory
import play.api.Configuration
import util.SidewalkSpec

import scala.jdk.CollectionConverters.*

/** Which database pool a city starts with (#4563). Pure config: no app boot and no database. */
class CityDbPoolSpec extends SidewalkSpec {
  private val slickDb = "slick.dbs.default.db"

  private def configFor(cityId: Option[String]): Configuration =
    Configuration.from(
      Map[String, Any](
        s"$slickDb.numThreads"                -> 20,
        s"$slickDb.maxConnections"            -> 20,
        s"$slickDb.minConnections"            -> 3,
        "db-pool.default.max-connections"     -> 25,
        "db-pool.default.min-connections"     -> 2,
        "db-pool.low-traffic.max-connections" -> 10,
        "db-pool.low-traffic.min-connections" -> 1,
        "city-params.low-traffic.quiet-town"  -> true,
        "city-params.low-traffic.opted-out"   -> false
      ) ++ cityId.map("city-id" -> _)
    )

  /** @return (threads, max connections, min connections) */
  private def poolOf(config: Configuration): (Int, Int, Int) = (
    config.get[Int](s"$slickDb.numThreads"),
    config.get[Int](s"$slickDb.maxConnections"),
    config.get[Int](s"$slickDb.minConnections")
  )

  "CityDbPool.applyTo" should {
    "give a low-traffic city the small pool, with threads matching connections" in {
      poolOf(CityDbPool.applyTo(configFor(Some("quiet-town")))) mustBe ((10, 10, 1))
    }

    "give an unlisted city the default pool" in {
      poolOf(CityDbPool.applyTo(configFor(Some("busy-city")))) mustBe ((25, 25, 2))
    }

    "give a city set to false the default pool" in {
      poolOf(CityDbPool.applyTo(configFor(Some("opted-out")))) mustBe ((25, 25, 2))
    }

    "change nothing when no city id is set" in {
      poolOf(CityDbPool.applyTo(configFor(None))) mustBe ((20, 20, 3))
    }

    "keep every other setting" in {
      CityDbPool.applyTo(configFor(Some("quiet-town"))).get[String]("city-id") mustBe "quiet-town"
    }
  }

  "CityDbPool.maxConnections" should {
    "report each city's own pool size" in {
      CityDbPool.maxConnections(configFor(None), "quiet-town") mustBe 10
      CityDbPool.maxConnections(configFor(None), "busy-city") mustBe 25
    }
  }

  "the shipped conf files" should {
    "say true or false for every city, so the whole list can be read in one place" in {
      val config  = ConfigFactory.load()
      val cityIds = config.getStringList("city-params.city-ids").asScala.toSet
      val listed  = config.getConfig("city-params.low-traffic").root().keySet().asScala.toSet
      listed mustBe cityIds
      cityIds.foreach(cityId => noException must be thrownBy config.getBoolean(s"city-params.low-traffic.$cityId"))
    }

    "define a small pool that is no bigger than the default" in {
      val config = Configuration(ConfigFactory.load())
      config.get[Int]("db-pool.low-traffic.max-connections") must be <= config.get[Int](
        "db-pool.default.max-connections"
      )
      config.get[Int]("db-pool.low-traffic.min-connections") must be <= config.get[Int](
        "db-pool.default.min-connections"
      )
      config.get[Int]("db-pool.low-traffic.min-connections") must be >= 0
    }
  }
}
