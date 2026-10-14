package models.street

import models.api.OsmWayLinkForApi
import models.utils.MyPostgresProfile.api.*
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec, StreetFixtures}

/**
 * A street's OSM way lineage (#5741): the `osm_way_street_edge_primary` view and `osm_way_at_fraction` function from
 * evolution 417, the table's constraints, and the siding of a link for one face. Every DB case runs inside a
 * rolled-back transaction on a street the fixtures seed along x from 0 to 1, so a fraction along it is its x.
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

    "count an unpositioned link as the whole street and break ties by the lowest id" in {
      val (primary, mixed) = runRolledBack(for {
        plain <- insertStreet()
        _     <- link(plain, 300L)
        _     <- link(plain, 200L)
        mixed <- insertStreet()
        _     <- link(mixed, 50L, Some((0.0, 0.6, 0.0, 1.0, true)))
        _     <- link(mixed, 999L)
        p     <- primaryOf(plain)
        m     <- primaryOf(mixed)
      } yield (p, m))
      primary mustBe Some(200L)
      mixed mustBe Some(999L)
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
