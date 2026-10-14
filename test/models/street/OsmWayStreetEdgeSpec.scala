package models.street

import models.api.OsmWayLinkForApi
import models.utils.MyPostgresProfile.api.*
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec, StreetFixtures}

/**
 * A street's OSM way lineage (#5741): the `osm_way_street_edge_primary` view, the triggers that keep `is_primary`
 * ranked, `osm_way_at_fraction`, the table's constraints, and the siding of a link for one face (evolution 417). Every DB case but the drift check runs inside a rolled-back transaction on a street the fixtures seed along
 * x from 0 to 1, so a fraction along it is its x.
 */
class OsmWayStreetEdgeSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb with StreetFixtures {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  /** Links a street to a way, positioned over the given stretch of the street, or unpositioned without one. */
  private def link(
      streetEdgeId: Int,
      wayId: Long,
      position: Option[(Double, Double, Double, Double, Boolean)] = None
  ): DBIO[Int] = position match {
    case Some((sf, st, wf, wt, same)) =>
      sqlu"""INSERT INTO osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id, street_from_frac,
                                              street_to_frac, way_from_frac, way_to_frac, same_direction, matched_at)
             VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge), $wayId,
                     $streetEdgeId, $sf, $st, $wf, $wt, $same, now())"""
    case None =>
      sqlu"""INSERT INTO osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id)
             VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge), $wayId,
                     $streetEdgeId)"""
  }

  /** The number of streets whose stored primary flag disagrees with a fresh ranking. */
  private def driftedPrimaries: DBIO[Int] =
    sql"""SELECT COUNT(*)
          FROM (SELECT DISTINCT ON (street_edge_id) street_edge_id, osm_way_street_edge_id AS ranked_id
                FROM osm_way_street_edge
                ORDER BY street_edge_id, (street_from_frac IS NOT NULL) DESC,
                         street_to_frac - street_from_frac DESC NULLS LAST, osm_way_id, osm_way_street_edge_id) ranked
          LEFT JOIN osm_way_street_edge ON ranked.street_edge_id = osm_way_street_edge.street_edge_id
              AND osm_way_street_edge.is_primary
          WHERE osm_way_street_edge.osm_way_street_edge_id IS DISTINCT FROM ranked.ranked_id""".as[Int].head

  private def primaryOf(streetEdgeId: Int): DBIO[Option[Long]] =
    sql"SELECT osm_way_id FROM osm_way_street_edge_primary WHERE street_edge_id = $streetEdgeId".as[Long].headOption

  private def wayAt(streetEdgeId: Int, frac: Option[Double]): DBIO[Option[Long]] =
    sql"SELECT osm_way_at_fraction($streetEdgeId, $frac)".as[Option[Long]].head

  "osm_way_street_edge_primary" should {
    "name the way covering most of the street, whatever the ids" in {
      val (primary, wayAtStart, wayAtEnd, wayNowhere) = runRolledBack(for {
        street <- insertStreet()
        _      <- link(street, 900L, Some((0.0, 0.3, 0.5, 1.0, true)))
        _      <- link(street, 100L, Some((0.3, 1.0, 0.0, 0.4, false)))
        p      <- primaryOf(street)
        a      <- wayAt(street, Some(0.1))
        b      <- wayAt(street, Some(0.9))
        n      <- wayAt(street, None)
      } yield (p, a, b, n))
      primary mustBe Some(100L)
      wayAtStart mustBe Some(900L)
      wayAtEnd mustBe Some(100L)
      // Without a position to look up, the primary way answers, so a label with no point still names a way.
      wayNowhere mustBe Some(100L)
    }

    "rank a placed link above an unplaced one, and break ties by the lowest id" in {
      val (primary, mixed, atEnd) = runRolledBack(for {
        plain <- insertStreet()
        _     <- link(plain, 300L)
        _     <- link(plain, 200L)
        mixed <- insertStreet()
        _     <- link(mixed, 999L)
        _     <- link(mixed, 50L, Some((0.0, 0.3, 0.0, 1.0, true)))
        p     <- primaryOf(plain)
        m     <- primaryOf(mixed)
        // Past every placed stretch, the fallback is the primary way, not the nearest placed one.
        e <- wayAt(mixed, Some(0.9))
      } yield (p, m, e))
      primary mustBe Some(200L)
      mixed mustBe Some(50L)
      atEnd mustBe Some(50L)
    }

    "keep the flag right as rows are inserted, repositioned and deleted" in {
      val (afterInsert, afterUpdate, afterDelete, set) = runRolledBack(for {
        street <- insertStreet()
        _      <- link(street, 1L, Some((0.0, 0.4, 0.0, 1.0, true)))
        _      <- link(street, 2L, Some((0.4, 1.0, 0.0, 1.0, true)))
        i      <- primaryOf(street)
        _      <- sqlu"""UPDATE osm_way_street_edge SET street_from_frac = 0.7
                         WHERE street_edge_id = $street AND osm_way_id = 2"""
        u <- primaryOf(street)
        _ <- sqlu"DELETE FROM osm_way_street_edge WHERE street_edge_id = $street AND osm_way_id = 1"
        d <- primaryOf(street)
        // The ranking is also callable by hand, and says how many streets it gave a primary way.
        n <- sql"SELECT osm_way_street_edge_set_primary(ARRAY[$street, -1])".as[Int].head
      } yield (i, u, d, n))
      afterInsert mustBe Some(2L)
      afterUpdate mustBe Some(1L)
      afterDelete mustBe Some(2L)
      set mustBe 1
    }

    "re-rank from a session whose search path does not name this schema, the way the CI seed loads" in {
      val primary = runRolledBack(for {
        street <- insertStreet()
        schema <- sql"SELECT current_schema()".as[String].head
        _      <- sqlu"SET LOCAL search_path = pg_catalog"
        _      <- sqlu"""INSERT INTO #$schema.osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id)
                         VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1
                                  FROM #$schema.osm_way_street_edge), 5, $street)"""
        p <- sql"""SELECT osm_way_id FROM #$schema.osm_way_street_edge
                        WHERE street_edge_id = $street AND is_primary""".as[Long].headOption
        _ <- sqlu"SET LOCAL search_path = #$schema, public"
      } yield p)
      primary mustBe Some(5L)
    }

    "be flagged on every street the way a fresh ranking would flag it" in {
      // The flag is cached (docs/evolutions.md): a trigger left disabled, or a load that bypassed it, shows here.
      run(driftedPrimaries) mustBe 0
    }

    "have no row for a street with no link, and the function no answer" in {
      val (primary, at) = runRolledBack(for {
        street <- insertStreet()
        p      <- primaryOf(street)
        a      <- wayAt(street, Some(0.5))
      } yield (p, a))
      primary mustBe None
      at mustBe None
    }
  }

  "osm_way_street_edge" should {
    "keep the position columns all set or all null" in {
      a[java.sql.SQLException] mustBe thrownBy(runRolledBack(for {
        street <- insertStreet()
        _      <- sqlu"""INSERT INTO osm_way_street_edge (osm_way_street_edge_id, osm_way_id, street_edge_id,
                                                          street_from_frac)
                         VALUES ((SELECT COALESCE(MAX(osm_way_street_edge_id), 0) + 1 FROM osm_way_street_edge),
                                 1, $street, 0.5)"""
      } yield ()))
    }

    "reject an interval that runs backwards" in {
      a[java.sql.SQLException] mustBe thrownBy(runRolledBack(for {
        street <- insertStreet()
        _      <- link(street, 1L, Some((0.6, 0.2, 0.0, 1.0, true)))
      } yield ()))
    }

    "allow one unpositioned row per street and way, and several positioned ones" in {
      val count = runRolledBack(for {
        street <- insertStreet()
        _      <- link(street, 7L)
        _      <- link(street, 7L, Some((0.0, 0.2, 0.0, 0.1, true)))
        _      <- link(street, 7L, Some((0.8, 1.0, 0.9, 1.0, true)))
        n      <- sql"SELECT COUNT(*) FROM osm_way_street_edge WHERE street_edge_id = $street".as[Int].head
      } yield n)
      count mustBe 3
      a[java.sql.SQLException] mustBe thrownBy(runRolledBack(for {
        street <- insertStreet()
        _      <- link(street, 7L)
        _      <- link(street, 7L)
      } yield ()))
    }
  }

  "OsmWayLinkForApi.withOsmSide" should {
    val positioned = OsmWayLinkForApi(5L, Some(0.0), Some(1.0), Some(0.2), Some(0.7), Some(true))

    "write a shapefile cell as way:from-to:mark, or the bare id without a position" in {
      positioned.shapefileText mustBe "5:0.000-1.000:+"
      positioned.copy(sameDirection = Some(false)).shapefileText mustBe "5:0.000-1.000:-"
      positioned.withOsmSide("left").shapefileText mustBe "5:0.000-1.000:left"
      OsmWayLinkForApi(5L, None, None, None, None, None).shapefileText mustBe "5"
      OsmWayLinkForApi(5L, None, None, None, None, None).withOsmSide("left").shapefileText mustBe "5"
    }

    "keep the side where the street runs the way's drawn direction, and flip it where it doesn't" in {
      positioned.withOsmSide("left").osmSide mustBe Some("left")
      positioned.withOsmSide("right").osmSide mustBe Some("right")
      val reversed = positioned.copy(sameDirection = Some(false))
      reversed.withOsmSide("left").osmSide mustBe Some("right")
      reversed.withOsmSide("right").osmSide mustBe Some("left")
    }

    "not guess a side for a link without a position" in {
      val unpositioned = OsmWayLinkForApi(5L, None, None, None, None, None)
      unpositioned.withOsmSide("left").osmSide mustBe None
    }
  }
}
