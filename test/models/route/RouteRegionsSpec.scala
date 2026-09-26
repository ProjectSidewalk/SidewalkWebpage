package models.route

import models.audit.AuditTaskTable
import models.label.LabelTable
import models.region.RegionTableDef
import models.street.{StreetEdgeRegionTableDef, StreetEdgeTable}
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

import java.time.OffsetDateTime

/**
 * DB-backed tests for what a route that crosses a region boundary needs from the database (#3488): the region it is
 * filed under follows its first street, listings can count the regions it runs through, a walk of it knows all of
 * them, its task list holds the streets of every one, and the labels Explore redraws are gathered from every one.
 *
 * These run the real queries against Postgres on purpose: several join grouped subqueries or filter across an outer
 * join, shapes Slick compiles happily and Postgres may still reject.
 *
 * Everything written here is rolled back — the dev DB is shared, so residue would pollute other work.
 */
class RouteRegionsSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val routeTable      = app.injector.instanceOf[RouteTable]
  private lazy val userRouteTable  = app.injector.instanceOf[UserRouteTable]
  private lazy val auditTaskTable  = app.injector.instanceOf[AuditTaskTable]
  private lazy val labelTable      = app.injector.instanceOf[LabelTable]
  private lazy val streetEdgeTable = app.injector.instanceOf[StreetEdgeTable]

  private val routes           = TableQuery[RouteTableDef]
  private val routeStreets     = TableQuery[RouteStreetTableDef]
  private val userRoutes       = TableQuery[UserRouteTableDef]
  private val streetEdgeRegion = TableQuery[StreetEdgeRegionTableDef]
  private val regions          = TableQuery[RegionTableDef]
  private val users            = TableQuery[SidewalkUserTableDef]

  /**
   * One street from each of two regions, as ((streetA, regionA), (streetB, regionB)).
   *
   * Drawn from the same filtered street query selectTasksInRoute joins against — a street that's hidden or is the
   * tutorial street would silently drop out of the task list and look like a query bug.
   */
  private def streetsInTwoRegions(): Option[((Int, Int), (Int, Int))] = {
    val rows: Seq[(Int, Int)] = run(
      streetEdgeRegion
        .join(regions.filter(!_.deleted))
        .on(_.regionId === _.regionId)
        .join(streetEdgeTable.streets)
        .on { case ((ser, _), street) => ser.streetEdgeId === street.streetEdgeId }
        .map { case ((ser, _), _) => (ser.streetEdgeId, ser.regionId) }
        .result
    )
    rows.groupBy(_._2).toSeq.sortBy(_._1).map(_._2.head) match {
      case first +: second +: _ => Some((first, second))
      case _                    => None
    }
  }

  "a route whose streets are in two regions" should {
    "be filed under its first street's region, count both, and hand a walk the streets of both" in {
      val picked = streetsInTwoRegions()
      assume(picked.isDefined, "the connected DB has routable streets in fewer than two regions")
      val ((streetA, regionA), (streetB, regionB)) = picked.get
      val userId: Option[String]                   = run(users.map(_.userId).result.headOption)
      assume(userId.isDefined, "no users in the connected DB")

      val (startRegion, regionCounts, walkRegions, taskStreets) = runRolledBack(for {
        // Inserted under the WRONG region, so the assertion below can only pass if updateStats re-derives it.
        routeId <- (routes returning routes.map(_.routeId)) += Route(
          0,
          userId.get,
          regionB,
          "Spec Two-Region Route",
          s"spec-route-${java.util.UUID.randomUUID}",
          None,
          public = false,
          deleted = false,
          OffsetDateTime.now,
          0d,
          0
        )
        _ <- routeStreets ++= Seq(
          RouteStreet(0, routeId, streetA, reverse = false, 0),
          RouteStreet(0, routeId, streetB, reverse = false, 1)
        )
        _           <- routeTable.updateStats(routeId)
        startRegion <- routes.filter(_.routeId === routeId).map(_.regionId).result.head
        counts      <- routeTable.getRegionCounts(Seq(routeId))
        userRouteId <- (userRoutes returning userRoutes.map(_.userRouteId)) +=
          UserRoute(0, routeId, userId.get, completed = false, discarded = false)
        walkRegions <- userRouteTable.getRegionIds(userRouteId)
        tasks       <- auditTaskTable.selectTasksInRoute(userRouteId)
      } yield (startRegion, counts.get(routeId), walkRegions, tasks.map(_.edgeId)))

      startRegion mustBe regionA
      regionCounts mustBe Some(2)
      walkRegions.toSet mustBe Set(regionA, regionB)
      taskStreets.toSet mustBe Set(streetA, streetB)
    }

    "know the region of a street, and that an unknown street has none" in {
      val picked = streetsInTwoRegions()
      assume(picked.isDefined, "the connected DB has routable streets in fewer than two regions")
      val ((streetA, regionA), _) = picked.get
      run(routeTable.getRegionIdOfStreet(streetA)) mustBe Some(regionA)
      run(routeTable.getRegionIdOfStreet(Int.MaxValue)) mustBe None
    }

    "count only the real streets among a submitted list" in {
      val picked = streetsInTwoRegions()
      assume(picked.isDefined, "the connected DB has routable streets in fewer than two regions")
      val ((streetA, _), (streetB, _)) = picked.get
      run(routeTable.countKnownStreets(Set(streetA, streetB))) mustBe 2
      run(routeTable.countKnownStreets(Set(streetA, Int.MaxValue))) mustBe 1
    }
  }

  "getLabelsFromUserInRegions" should {
    "find a label through its mission's region and through its street's region, and through no other" in {
      // A real label with everything the query inner-joins, plus both of the regions that can claim it.
      val found: Option[(Int, String, Option[Int], Int)] = run(sql"""
        SELECT label.label_id, label.user_id, mission.region_id, street_edge_region.region_id
        FROM label
        INNER JOIN mission ON label.mission_id = mission.mission_id
        INNER JOIN label_point ON label.label_id = label_point.label_id
        INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
        INNER JOIN street_edge_region ON label.street_edge_id = street_edge_region.street_edge_id
        WHERE label.tutorial = FALSE
            AND label_point.lat IS NOT NULL
            AND label_point.lng IS NOT NULL
        LIMIT 1
      """.as[(Int, String, Option[Int], Int)].headOption)
      assume(found.isDefined, "no labels in this schema; needs a seeded DB")
      val (labelId, userId, missionRegion, streetRegion) = found.get

      def labelIdsIn(regionIds: Seq[Int]): Seq[Int] =
        run(labelTable.getLabelsFromUserInRegions(regionIds, userId)).map(_.labelData.labelId)

      labelIdsIn(Seq(streetRegion)) must contain(labelId)
      missionRegion.foreach(regionId => labelIdsIn(Seq(regionId)) must contain(labelId))
      // No region has a negative id, so this names neither of the label's regions.
      labelIdsIn(Seq(-1)) must not contain labelId
      labelIdsIn(Seq.empty) mustBe empty
    }
  }
}
