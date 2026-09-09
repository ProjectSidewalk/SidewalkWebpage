package models.street

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsValue, Json}
import slick.dbio.DBIO

import java.time.temporal.ChronoUnit
import java.time.{Instant, OffsetDateTime}
import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed contract test for how the nightly refresh records a way that Overpass no longer returns (#5244, evolution
 * 380).
 *
 * A mapped way id can die in OSM (the way deleted or merged away) while the street it described stays in our
 * network. The refresh must keep that way's last known tags -- they still describe the geometry we imported, and
 * `bridge`/`tunnel`/`layer` on a dead way id are what keeps a bridge grade-separated -- and date the disappearance in
 * `missing_since`, once. Every case here is one edge of that contract.
 *
 * Seeds its own rows under ids no real way will ever reach, so it can never pass vacuously and never touches a
 * mapped way. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI);
 * the scheduling actors are disabled so no background refresh touches the rows mid-test.
 */
class OsmWayTableSpec extends PlaySpec with BeforeAndAfterAll with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val osmWayTable = app.injector.instanceOf[OsmWayTable]
  private val dbConfig    = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]

  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val wayId      = 900000000001L
  private val unseenId   = 900000000002L
  private val bridgeTags = Json.obj("highway" -> "primary", "bridge" -> "yes", "layer" -> "1", "maxspeed" -> "40 mph")

  private def cleanup(): Unit = { val _ = run(sqlu"DELETE FROM osm_way WHERE osm_way_id IN ($wayId, $unseenId)") }

  override def beforeAll(): Unit = { super.beforeAll(); cleanup() }
  override def afterAll(): Unit  = { cleanup(); super.afterAll() }

  /** (tags, maxspeed, updated_at, missing_since) as stored, instants truncated to the microseconds Postgres keeps. */
  private def row(id: Long): (JsValue, Option[String], Instant, Option[Instant]) = {
    val (tags, maxspeed, updatedAt, missingSince) = run(
      sql"SELECT tags::text, maxspeed, updated_at, missing_since FROM osm_way WHERE osm_way_id = $id"
        .as[(String, Option[String], OffsetDateTime, Option[OffsetDateTime])]
        .head
    )
    (Json.parse(tags), maxspeed, micros(updatedAt), missingSince.map(micros))
  }

  private def micros(time: OffsetDateTime): Instant = time.toInstant.truncatedTo(ChronoUnit.MICROS)

  "OsmWayTable.upsertBatch" should {
    "store a found way's tags with no missing mark" in {
      val fetchedAt = OffsetDateTime.now
      run(osmWayTable.upsertBatch(Seq((wayId, bridgeTags, Some("40 mph"))), Nil, fetchedAt)) mustBe 1
      row(wayId) mustBe ((bridgeTags, Some("40 mph"), micros(fetchedAt), None))
    }

    "keep the last known tags and stamp missing_since when the way is gone from OSM" in {
      val goneAt = OffsetDateTime.now
      run(osmWayTable.upsertBatch(Nil, Seq(wayId), goneAt)) mustBe 1
      row(wayId) mustBe ((bridgeTags, Some("40 mph"), micros(goneAt), Some(micros(goneAt))))
    }

    "keep the first missing_since when a later refresh finds the way still gone" in {
      val firstStamp = row(wayId)._4
      val recheckAt  = OffsetDateTime.now.plusDays(30)
      run(osmWayTable.upsertBatch(Nil, Seq(wayId), recheckAt))
      val (tags, maxspeed, updatedAt, missingSince) = row(wayId)
      tags mustBe bridgeTags
      maxspeed mustBe Some("40 mph")
      updatedAt mustBe micros(recheckAt)
      missingSince mustBe firstStamp
    }

    "take the new tags and clear missing_since when the way is back" in {
      val backTags = Json.obj("highway" -> "primary", "bridge" -> "yes", "layer" -> "1")
      val backAt   = OffsetDateTime.now
      run(osmWayTable.upsertBatch(Seq((wayId, backTags, None)), Nil, backAt))
      row(wayId) mustBe ((backTags, None, micros(backAt), None))
    }

    "insert a never-seen way that is already gone with empty tags, so it is not re-queued nightly" in {
      val goneAt = OffsetDateTime.now
      run(osmWayTable.upsertBatch(Nil, Seq(unseenId), goneAt)) mustBe 1
      row(unseenId) mustBe ((Json.obj(), None, micros(goneAt), Some(micros(goneAt))))
    }

    "count found and missing ways together, and write nothing for an empty chunk" in {
      run(osmWayTable.upsertBatch(Seq((wayId, bridgeTags, Some("40 mph"))), Seq(unseenId), OffsetDateTime.now)) mustBe 2
      run(osmWayTable.upsertBatch(Nil, Nil, OffsetDateTime.now)) mustBe 0
    }
  }
}
