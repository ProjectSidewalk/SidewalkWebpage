package models.place

import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.{Coordinate, GeometryFactory, PrecisionModel}
import org.scalatest.OptionValues
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.Json
import util.{RolledBackDb, StreetFixtures}

import scala.io.Source

/**
 * The `place` table's refresh merge (#5311), against the connected Postgres+PostGIS database, every case inside a
 * rolled-back transaction: which fetched objects it keeps, what it fills in for them, and that a place's id survives
 * a refresh. Also holds evolution 396's category CHECK to the Scala catalog, so a category added to one is missed by
 * the spec rather than by the first refresh that writes it.
 *
 * The seeded world is [[util.StreetFixtures]]'s: a region that is the unit square and a street along its bottom edge,
 * both at the equator, so a place a fraction of a degree in sits in the region and a known distance from the street.
 */
class PlaceTableSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb with StreetFixtures with OptionValues {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val table: PlaceTable = app.injector.instanceOf[PlaceTable]

  private val gf = new GeometryFactory(new PrecisionModel(), 4326)

  /** A fetched OSM node at (lng, lat). */
  private def fetched(
      id: Long,
      category: String,
      name: Option[String],
      lng: Double,
      lat: Double,
      osmType: String = "node"
  ): FetchedPlace =
    FetchedPlace(
      category,
      name,
      osmType,
      id,
      Json.obj("name" -> name.getOrElse[String]("")),
      gf.createPoint(new Coordinate(lng, lat))
    )

  private def placeByOsm(osmType: String, osmId: Long): DBIO[Option[Place]] =
    table.places.filter(p => p.osmType === osmType && p.osmId === osmId).result.headOption

  /** A city-supplied row, which no refresh may touch. */
  private def insertCityPlace(name: String, lng: Double, lat: Double): DBIO[Int] =
    sql"""INSERT INTO place (category, name, source, tags, geom, fetched_at)
          VALUES ('school', $name, 'city', '{}', ST_SetSRID(ST_MakePoint($lng, $lat), 4326), now())
          RETURNING place_id""".as[Int].head

  "the category CHECK in evolution 396" should {
    "list exactly the catalog's ids, in its order" in {
      val script = {
        val source = Source.fromFile("conf/evolutions/default/396.sql", "UTF-8")
        try source.mkString
        finally source.close()
      }
      val check  = "category TEXT NOT NULL CHECK \\(category IN \\(([^)]*)\\)\\)".r
      val listed =
        check.findFirstMatchIn(script).value.group(1).split(",").map(_.trim.stripPrefix("'").stripSuffix("'"))
      listed.toSeq mustBe PlaceCategory.ids
    }
  }

  "replaceOsmPlaces" should {
    "insert the fetched places with their region and nearest street, and drop the ones outside the city" in {
      val fetchedAt                     = now
      val (counts, school, existingOsm) = runRolledBack(for {
        existingOsm <- table.osmPlaceCount
        regionId    <- insertRegion()
        streetId    <- insertStreet(Some(regionId))
        counts      <- table.replaceOsmPlaces(
          Seq(
            // 0.0001 deg north of the equator-hugging street: about 11 m away, inside the unit-square region.
            fetched(1L, "school", Some("Spec School"), lng = 0.5, lat = 0.0001),
            // Inside the region but no street within 250 m of it.
            fetched(2L, "park", None, lng = 0.5, lat = 0.5),
            // Far from every region: bounding-box noise, dropped.
            fetched(3L, "transit", Some("Nowhere"), lng = 5.0, lat = 5.0)
          ),
          fetchedAt
        )
        school <- placeByOsm("node", 1L)
        park   <- placeByOsm("node", 2L)
        far    <- placeByOsm("node", 3L)
      } yield {
        far mustBe None
        park.value.regionId mustBe Some(regionId)
        park.value.nearestStreetEdgeId mustBe None
        park.value.nearestStreetDistanceM mustBe None
        park.value.name mustBe None
        school.value.nearestStreetEdgeId mustBe Some(streetId)
        (counts, school.value, existingOsm)
      })

      counts.fetched mustBe 3
      counts.dropped mustBe 1
      counts.inserted mustBe 2
      counts.updated mustBe 0
      // Every OSM place the connected schema already held is absent from this fetch, so the merge removes them.
      counts.deleted mustBe existingOsm
      school.category mustBe "school"
      school.source mustBe "osm"
      school.nearestStreetDistanceM.value mustBe (11.1 +- 0.5)
      school.fetchedAt.toInstant mustBe fetchedAt.toInstant
    }

    "keep a place's id across a refresh, update what changed, delete what is gone, and leave city rows alone" in {
      val first                                     = now.minusDays(8)
      val second                                    = now
      val (firstId, again, counts, cityRow, cityId) = runRolledBack(for {
        regionId <- insertRegion()
        _        <- insertStreet(Some(regionId))
        cityId   <- insertCityPlace("City Hall School", lng = 0.4, lat = 0.2)
        _        <- table.replaceOsmPlaces(
          Seq(
            fetched(1L, "school", Some("Spec School"), lng = 0.5, lat = 0.0001),
            fetched(2L, "park", Some("Spec Park"), lng = 0.5, lat = 0.5)
          ),
          first
        )
        firstId <- placeByOsm("node", 1L).map(_.value.placeId)
        counts  <- table.replaceOsmPlaces(
          Seq(
            // Same object, renamed and moved a little: an update, not a new row.
            fetched(1L, "school", Some("Spec Academy"), lng = 0.5, lat = 0.0002),
            // New this week.
            fetched(4L, "library", Some("Spec Library"), lng = 0.6, lat = 0.0001, osmType = "way")
          ),
          second
        )
        again   <- placeByOsm("node", 1L)
        park    <- placeByOsm("node", 2L)
        library <- placeByOsm("way", 4L)
        cityRow <- table.places.filter(_.placeId === cityId).result.headOption
      } yield {
        park mustBe None
        library.value.category mustBe "library"
        (firstId, again.value, counts, cityRow.value, cityId)
      })

      again.placeId mustBe firstId
      again.name mustBe Some("Spec Academy")
      again.fetchedAt.toInstant mustBe second.toInstant
      counts.inserted mustBe 1
      counts.updated mustBe 1
      counts.deleted mustBe 1
      cityRow.placeId mustBe cityId
      cityRow.source mustBe "city"
      cityRow.name mustBe Some("City Hall School")
    }

    "move only the timestamp of a place that came back unchanged, without counting it as updated" in {
      val first         = now.minusDays(8)
      val second        = now
      val place         = fetched(1L, "school", Some("Spec School"), lng = 0.5, lat = 0.0001)
      val (counts, row) = runRolledBack(for {
        regionId <- insertRegion()
        _        <- insertStreet(Some(regionId))
        _        <- table.replaceOsmPlaces(Seq(place), first)
        counts   <- table.replaceOsmPlaces(Seq(place), second)
        row      <- placeByOsm("node", 1L)
      } yield (counts, row.value))

      counts.updated mustBe 0
      counts.inserted mustBe 0
      row.fetchedAt.toInstant mustBe second.toInstant
    }
  }

  "regionsExtent" should {
    "cover every live region" in {
      // StreetFixtures' region is the unit square at the equator, well outside any city the schema holds.
      val extent = runRolledBack(for {
        _      <- insertRegion()
        extent <- table.regionsExtent
      } yield extent)
      extent.value.minLat must be <= 0.0
      extent.value.minLng must be <= 0.0
      extent.value.maxLat must be >= 1.0
      extent.value.maxLng must be >= 1.0
    }
  }

  "newestFetchedAt" should {
    "report the latest OSM fetch, ignoring city rows" in {
      val when            = now.minusDays(3)
      val (before, after) = runRolledBack(for {
        _      <- sqlu"DELETE FROM place WHERE source = 'osm'"
        _      <- insertCityPlace("City Hall School", lng = 0.4, lat = 0.2)
        before <- table.newestFetchedAt
        _      <- insertRegion()
        _      <- table.replaceOsmPlaces(Seq(fetched(1L, "school", None, lng = 0.5, lat = 0.5)), when)
        after  <- table.newestFetchedAt
      } yield (before, after))

      before mustBe None
      after.value.toInstant mustBe when.toInstant
    }
  }
}
