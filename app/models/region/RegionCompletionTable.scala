package models.region

import models.street.{StreetEdgeRegionTable, StreetEdgeTable}
import models.user.UserCurrentRegionTable
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

import slick.jdbc.GetResult

import scala.concurrent.ExecutionContext.Implicits.global

case class RegionCompletion(regionId: Int, totalDistance: Double, auditedDistance: Double)
case class NamedRegionCompletion(regionId: Int, name: Option[String], totalDistance: Double, auditedDistance: Double)

class RegionCompletionTable(tag: Tag) extends Table[RegionCompletion](tag, Some("sidewalk"), "region_completion") {
  def regionId = column[Int]("region_id", O.PrimaryKey)
  def totalDistance = column[Double]("total_distance")
  def auditedDistance = column[Double]("audited_distance")

  def * = (regionId, totalDistance, auditedDistance) <> ((RegionCompletion.apply _).tupled, RegionCompletion.unapply)
}

/**
  * Data access object for the sidewalk_edge table
  */
object RegionCompletionTable {
  import MyPostgresDriver.api._

  implicit val regionCompletionConverter = GetResult[RegionCompletion](r => {
    RegionCompletion(r.nextInt, r.nextDouble, r.nextDouble)
  })

//  implicit val namedRegionConverter = GetResult[NamedRegion](r => {
//    NamedRegion(r.nextInt, r.nextStringOption, r.nextGeometry[Polygon])
//  })

  case class StreetCompletion(regionId: Int, regionName: String, streetEdgeId: Int, completionCount: Int, distance: Double)
  implicit val streetCompletionConverter = GetResult[StreetCompletion](r => {
    StreetCompletion(r.nextInt, r.nextString, r.nextInt, r.nextInt, r.nextDouble)
  })

  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val regionCompletions = TableQuery[RegionCompletionTable]
  val regions = TableQuery[RegionTable]
  val regionTypes = TableQuery[RegionTypeTable]
  val regionProperties = TableQuery[RegionPropertyTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val streetEdgeRegion = TableQuery[StreetEdgeRegionTable]
  val userCurrentRegions = TableQuery[UserCurrentRegionTable]

  val regionsWithoutDeleted = regions.filter(_.deleted === false)
  val streetEdgesWithoutDeleted = streetEdges.filter(_.deleted === false)
  val neighborhoods = regionsWithoutDeleted.filter(_.regionTypeId === 2)
  val streetEdgeNeighborhood = for { (se, n) <- streetEdgeRegion.join(neighborhoods).on(_.regionId === _.regionId) } yield se


  /**
    * Returns a list of all neighborhoods with names
    * @return
    */
  def selectAllNamedNeighborhoodCompletions: Future[List[NamedRegionCompletion]] = {
    val namedRegionCompletions = for {
      (_neighborhoodCompletions, _regionProperties) <- regionCompletions.joinLeft(regionProperties).on(_.regionId === _.regionId)
      if _regionProperties.map(_.key === "Neighborhood Name").isDefined
    } yield (_neighborhoodCompletions.regionId, _regionProperties.map(_.value), _neighborhoodCompletions.totalDistance, _neighborhoodCompletions.auditedDistance)

    db.run(namedRegionCompletions.to[List].result)
      .map(_.map(NamedRegionCompletion.tupled))
  }
  /**
    *
    */


  /**
    * Increments the `audited_distance` column of the corresponding region by the length of the specified street edge.
    * Reference: http://slick.lightbend.com/doc/2.0.0/queries.html#updating
    *
    * @param streetEdgeId street edge id
    * @return
    */
  def updateAuditedDistance(streetEdgeId: Int): Future[List[Int]] = {
// TODO TRANSACTIONNNNNNNNNNNNNN
    StreetEdgeTable.getStreetEdgeDistance(streetEdgeId).flatMap { distToAdd =>
      db.run(
        streetEdgeNeighborhood.filter(_.streetEdgeId === streetEdgeId).groupBy(x => x).map(_._1.regionId).to[List].result
      ).flatMap { regionIds =>
        val opFutures =
          for (regionId <- regionIds) yield {
            val q = for {regionCompletion <- regionCompletions if regionCompletion.regionId === regionId} yield regionCompletion

            db.run(
              q.result.headOption
            ).flatMap {
              case Some(rC) =>
                // Check if the neighborhood is fully audited, and set audited_distance equal to total_distance if so. We are
                // doing this to fix floating point error, so that in the end, the region is marked as exactly 100% complete.
                // Also doing a check to see if the completion is erroneously over 100%, when the streets have not all been
                // audited in that neighborhood; this has never been observed, but it could theoretically be an issue if there
                // is a sizable error, while there is a single (very very short) street segment left to be audited. That case
                // shouldn't happen, but we are just being safe, and setting audited_distance to be less than total_distance.
                StreetEdgeRegionTable.allStreetsInARegionAudited(regionId).flatMap {
                  case true   =>
                    db.run(
                      q.map(_.auditedDistance).update(rC.totalDistance).transactionally
                    )
                  case false  =>
                    if (rC.auditedDistance + distToAdd > rC.totalDistance) {
                      db.run(
                        q.map(_.auditedDistance).update(rC.totalDistance * 0.995).transactionally
                      )
                    } else {
                      db.run(
                        q.map(_.auditedDistance).update(rC.auditedDistance + distToAdd).transactionally
                      )
                    }
                }
              case None => Future.successful(-1)
            }
          }

        Future.sequence(opFutures)
      }
    }
  }

  def initializeRegionCompletionTable(): Future[Any] = {
    // TODO TRANSACTIONNNNNNNNNNNNNN

    val nRegionCompletionsFuture: Future[Int] = db.run(regionCompletions.length.result)
    nRegionCompletionsFuture.flatMap { nRegionCompletions =>

      if (nRegionCompletions == 0) {

        RegionTable.selectAllNamedNeighborhoods.flatMap { neighborhoods =>

          val neighborhoodsOps = for (neighborhood <- neighborhoods) yield {

            // Check if the neighborhood is fully audited, and set audited_distance equal to total_distance if so. We are
            // doing this to fix floating point error, so that in the end, the region is marked as exactly 100% complete.
            StreetEdgeRegionTable.allStreetsInARegionAudited(neighborhood.regionId).flatMap {
              case true =>
                StreetEdgeTable.getTotalDistanceOfARegion(neighborhood.regionId).flatMap { totalDistance =>
                  db.run(
                    (regionCompletions += RegionCompletion(neighborhood.regionId, totalDistance.toDouble, totalDistance.toDouble)).transactionally
                  )
                }
              case false =>
                (for {
                  auditedDistance <- StreetEdgeTable.getDistanceAuditedInARegion(neighborhood.regionId)
                  totalDistance <- StreetEdgeTable.getTotalDistanceOfARegion(neighborhood.regionId)
                } yield (auditedDistance.toDouble, totalDistance.toDouble)).flatMap {
                  case (auditedDistance: Double, totalDistance: Double) =>
                    db.run(
                      (regionCompletions += RegionCompletion(neighborhood.regionId, totalDistance, auditedDistance)).transactionally
                    )
                }
            }
          }
          Future.sequence(neighborhoodsOps)
        }
      } else Future.successful(Nil)
    }
  }
}
