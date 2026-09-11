package models.street

import models.utils.MyPostgresProfile.api._
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsValue, Json}
import slick.dbio.DBIO
import util.{RolledBackDb, StreetFixtures}

import java.time.temporal.ChronoUnit
import java.time.{Instant, OffsetDateTime}

/**
 * DB-backed contract test for how the nightly refresh records a way the OSM API reports gone (#5244, evolution
 * 380) and how the lost tags of such a way are recovered from the OSM history (step 2, evolution 382).
 *
 * A mapped way id can die in OSM (the way deleted or merged away) while the street it described stays in our
 * network. The refresh must keep that way's last known tags -- they still describe the geometry we imported, and
 * `bridge`/`tunnel`/`layer` on a dead way id are what keeps a bridge grade-separated -- and date the disappearance in
 * `missing_since`, once. A way blanked before the refresh learned that is looked up in the OSM history exactly once,
 * whatever the history held. Every case here is one edge of that contract.
 *
 * Seeds its own rows under ids no real way will ever reach, so it can never pass vacuously and never touches a
 * mapped way. Requires a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI);
 * the scheduling actors are disabled so no background refresh touches the rows mid-test.
 */
class OsmWayTableSpec
    extends PlaySpec
    with BeforeAndAfterAll
    with GuiceOneAppPerSuite
    with RolledBackDb
    with StreetFixtures {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val osmWayTable = app.injector.instanceOf[OsmWayTable]

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

  /** The recovery contract's three seeded ways, all mapped to a street so the backfill scan can see them. */
  private val blankedId   = 900000000003L
  private val keptTagsId  = 900000000004L
  private val checkedId   = 900000000005L
  private val recoveryIds = Seq(blankedId, keptTagsId, checkedId)

  /** A gone way, mapped to a fresh street, with the given tags and source. */
  private def insertGoneWay(osmWayId: Long, tags: JsValue, source: String, goneAt: OffsetDateTime): DBIO[Int] =
    for {
      streetEdgeId <- insertStreet()
      _            <- sqlu"""INSERT INTO osm_way (osm_way_id, tags, maxspeed, geom, source, updated_at, missing_since)
                  VALUES ($osmWayId, ${Json.stringify(tags)}::jsonb, NULL, NULL, $source, $goneAt, $goneAt)"""
      n <- sqlu"""INSERT INTO osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id)
                  VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge),
                          $osmWayId, $streetEdgeId)"""
    } yield n

  /** (tags, maxspeed, source, updated_at, missing_since) as stored, read inside the test's transaction. */
  private def storedRow(id: Long): DBIO[(JsValue, Option[String], String, Instant, Option[Instant])] =
    sql"SELECT tags::text, maxspeed, source, updated_at, missing_since FROM osm_way WHERE osm_way_id = $id"
      .as[(String, Option[String], String, OffsetDateTime, Option[OffsetDateTime])]
      .head
      .map { case (tags, maxspeed, source, updatedAt, missingSince) =>
        (Json.parse(tags), maxspeed, source, micros(updatedAt), missingSince.map(micros))
      }

  "OsmWayTable.getStreetNames" should {
    "name a mapped street from its way's name tag and skip unnamed or blank ones" in {
      val named = runRolledBack(for {
        namedStreet   <- insertStreet()
        blankStreet   <- insertStreet()
        unnamedStreet <- insertStreet()
        _             <- sqlu"""INSERT INTO osm_way (osm_way_id, tags, maxspeed, geom, source, updated_at)
                  VALUES ($blankedId, '{"name": " Main St "}'::jsonb, NULL, NULL, 'batch', now()),
                         ($keptTagsId, '{"name": "  "}'::jsonb, NULL, NULL, 'batch', now()),
                         ($checkedId, '{"highway": "residential"}'::jsonb, NULL, NULL, 'batch', now())"""
        _ <- sqlu"""INSERT INTO osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id)
                  VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge),
                          $blankedId, $namedStreet),
                         ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 2 FROM osm_way_street_edge),
                          $keptTagsId, $blankStreet),
                         ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 3 FROM osm_way_street_edge),
                          $checkedId, $unnamedStreet)"""
        names <- osmWayTable.getStreetNames(Seq(namedStreet, blankStreet, unnamedStreet))
      } yield names)
      named.values.toSeq mustBe Seq("Main St")
      named.size mustBe 1
    }

    "take a whole city's worth of ids: more than pgjdbc's 65,535 bound parameters" in {
      // Ids that match nothing are fine: the point is that pgjdbc accepts the statement (Chicago's ~112k didn't).
      run(osmWayTable.getStreetNames(Seq.range(900000000, 900070000))) mustBe Map.empty
      run(osmWayTable.getStreetNames(Nil)) mustBe Map.empty
    }
  }

  "OsmWayTable.getWayIdsToBackfill" should {
    "list only the gone ways whose tags are empty and whose history has not been read" in {
      val goneAt = OffsetDateTime.now
      val listed = runRolledBack(for {
        _   <- insertGoneWay(blankedId, Json.obj(), "batch", goneAt)
        _   <- insertGoneWay(keptTagsId, bridgeTags, "batch", goneAt)
        _   <- insertGoneWay(checkedId, Json.obj(), "history", goneAt)
        ids <- osmWayTable.getWayIdsToBackfill
      } yield ids.filter(recoveryIds.contains))
      listed mustBe Seq(blankedId)
    }
  }

  "OsmWayTable.recordHistoryTags" should {
    "store recovered tags under source 'history', keeping the way marked missing and its refresh fetch time" in {
      val goneAt                = OffsetDateTime.now.minusDays(3)
      val (stored, listedAfter) = runRolledBack(for {
        _      <- insertGoneWay(blankedId, Json.obj(), "batch", goneAt)
        n      <- osmWayTable.recordHistoryTags(blankedId, Some(bridgeTags), Some("40 mph"))
        stored <- storedRow(blankedId)
        ids    <- osmWayTable.getWayIdsToBackfill
      } yield { n mustBe 1; (stored, ids.filter(recoveryIds.contains)) })
      stored mustBe ((bridgeTags, Some("40 mph"), "history", micros(goneAt), Some(micros(goneAt))))
      listedAfter mustBe Nil
    }

    "mark a way whose history held nothing as checked, with empty tags, so it is not looked up again" in {
      val goneAt                = OffsetDateTime.now
      val (stored, listedAfter) = runRolledBack(for {
        _      <- insertGoneWay(blankedId, Json.obj(), "batch", goneAt)
        _      <- osmWayTable.recordHistoryTags(blankedId, None, None)
        stored <- storedRow(blankedId)
        ids    <- osmWayTable.getWayIdsToBackfill
      } yield (stored, ids.filter(recoveryIds.contains)))
      stored mustBe ((Json.obj(), None, "history", micros(goneAt), Some(micros(goneAt))))
      listedAfter mustBe Nil
    }

    "write nothing for a way that has no row" in {
      runRolledBack(osmWayTable.recordHistoryTags(unseenId + 100, Some(bridgeTags), None)) mustBe 0
    }

    "leave a way alone that came back to life while its history was being read" in {
      val (written, stored) = runRolledBack(for {
        _ <- insertGoneWay(blankedId, Json.obj(), "batch", OffsetDateTime.now)
        // Another run's refresh found the way in OSM again and wrote its live tags.
        _       <- osmWayTable.upsertBatch(Seq((blankedId, bridgeTags, Some("40 mph"))), Nil, OffsetDateTime.now)
        written <- osmWayTable.recordHistoryTags(blankedId, Some(Json.obj("highway" -> "footway")), None)
        stored  <- storedRow(blankedId)
      } yield (written, stored))
      written mustBe 0
      stored._1 mustBe bridgeTags
      stored._3 mustBe "batch"
    }

    "keep recovered tags and the 'history' source through a later refresh that still finds the way gone" in {
      val goneAt    = OffsetDateTime.now.minusDays(40)
      val recheckAt = OffsetDateTime.now
      val stored    = runRolledBack(for {
        _      <- insertGoneWay(blankedId, bridgeTags, "history", goneAt)
        _      <- osmWayTable.upsertBatch(Nil, Seq(blankedId), recheckAt)
        stored <- storedRow(blankedId)
      } yield stored)
      stored mustBe ((bridgeTags, None, "history", micros(recheckAt), Some(micros(goneAt))))
    }
  }

  "OsmWayTable.getWayIdsMissingOrStale" should {
    "re-check a stale gone way, recovered or not, but never one the API has nothing for" in {
      val staleAt = OffsetDateTime.now.minusDays(40)
      val cutoff  = OffsetDateTime.now.minusDays(30)
      val listed  = runRolledBack(for {
        _   <- insertGoneWay(blankedId, Json.obj(), "batch", staleAt)    // gone, blanked: re-check
        _   <- insertGoneWay(keptTagsId, bridgeTags, "history", staleAt) // gone, recovered: re-check
        _   <- insertGoneWay(checkedId, Json.obj(), "history", staleAt)  // never held: nothing to come back
        ids <- osmWayTable.getWayIdsMissingOrStale(cutoff)
      } yield ids.filter(recoveryIds.contains))
      listed mustBe Seq(blankedId, keptTagsId)
    }

    "leave a fresh row alone and list a mapped way with no row at all" in {
      val cutoff = OffsetDateTime.now.minusDays(30)
      val listed = runRolledBack(for {
        _            <- insertGoneWay(blankedId, Json.obj(), "batch", OffsetDateTime.now)
        streetEdgeId <- insertStreet()
        _            <- sqlu"""INSERT INTO osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id)
                    VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge),
                            $keptTagsId, $streetEdgeId)"""
        ids <- osmWayTable.getWayIdsMissingOrStale(cutoff)
      } yield ids.filter(recoveryIds.contains))
      listed mustBe Seq(keptTagsId)
    }
  }
}
