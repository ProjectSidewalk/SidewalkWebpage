package models.region

import models.street.{StreetEdgePriorityTable, StreetEdgeRegionTable, StreetEdgeTable}
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.jdbc.{GetResult, StaticQuery => Q}

case class RegionCompletion(regionId: Int, totalDistance: Double, auditedDistance: Double)
case class NamedRegionCompletion(regionId: Int, name: String, totalDistance: Double, auditedDistance: Double)

class RegionCompletionTable(tag: Tag) extends Table[RegionCompletion](tag, Some("sidewalk"), "region_completion") {
  def regionId = column[Int]("region_id", O.PrimaryKey)
  def totalDistance = column[Double]("total_distance")
  def auditedDistance = column[Double]("audited_distance")

  def * = (regionId, totalDistance, auditedDistance) <> ((RegionCompletion.apply _).tupled, RegionCompletion.unapply)
}

/**
  * Data access object for the region_completion table.
  */
object RegionCompletionTable {
  import MyPostgresDriver.plainImplicits._

  implicit val regionCompletionConverter = GetResult[RegionCompletion](r => {
    RegionCompletion(r.nextInt, r.nextDouble, r.nextDouble)
  })

  case class StreetCompletion(regionId: Int, regionName: String, streetEdgeId: Int, completionCount: Int, distance: Double)
  implicit val streetCompletionConverter = GetResult[StreetCompletion](r => {
    StreetCompletion(r.nextInt, r.nextString, r.nextInt, r.nextInt, r.nextDouble)
  })

  val db = play.api.db.slick.DB
  val regionCompletions = TableQuery[RegionCompletionTable]
  val regions = TableQuery[RegionTable]
  val streetEdgeRegion = TableQuery[StreetEdgeRegionTable]

  val regionsWithoutDeleted = regions.filter(_.deleted === false)
  val streetEdgeNeighborhood = for {
    (se, n) <- streetEdgeRegion.innerJoin(regionsWithoutDeleted).on(_.regionId === _.regionId)
  } yield se

  /**
    * Returns a list of all neighborhoods with names.
    */
  def selectAllNamedNeighborhoodCompletions: List[NamedRegionCompletion] = db.withSession { implicit session =>
    val namedRegionCompletions = for {
      _rc <- regionCompletions
      _r <- regionsWithoutDeleted if _rc.regionId === _r.regionId
    } yield (_r.regionId, _r.name, _rc.totalDistance, _rc.auditedDistance)

    namedRegionCompletions.list.map(x => NamedRegionCompletion.tupled(x))
  }

  /**
    * Increase the `audited_distance` column of the corresponding region by the length of the specified street edge.
    */
  def updateAuditedDistance(streetEdgeId: Int) = db.withTransaction { implicit session =>

    val distToAdd: Float = StreetEdgeTable.getStreetEdgeDistance(streetEdgeId)
    val regionIds: List[Int] = streetEdgeNeighborhood.filter(_.streetEdgeId === streetEdgeId).groupBy(x => x).map(_._1.regionId).list

    for (regionId <- regionIds) yield {
      val q = for {regionCompletion <- regionCompletions if regionCompletion.regionId === regionId} yield regionCompletion

      val updatedDist = q.firstOption match {
        case Some(rC) =>
          // Check if the neighborhood is fully audited, and set audited_distance equal to total_distance if so. We are
          // doing this to fix floating point error, so that in the end, the region is marked as exactly 100% complete.
          // Also doing a check to see if the completion is erroneously over 100%, when the streets have not all been
          // audited in that neighborhood; this has never been observed, but it could theoretically be an issue if there
          // is a sizable error, while there is a single (very very short) street segment left to be audited. That case
          // shouldn't happen, but we are just being safe, and setting audited_distance to be less than total_distance.
          if (StreetEdgePriorityTable.allStreetsInARegionAuditedUsingPriority(regionId)) {
            q.map(_.auditedDistance).update(rC.totalDistance)
          } else if (rC.auditedDistance + distToAdd > rC.totalDistance) {
            q.map(_.auditedDistance).update(rC.totalDistance * 0.995)
          } else {
            q.map(_.auditedDistance).update(rC.auditedDistance + distToAdd)
          }
        case None => -1
      }
    }
  }

  def initializeRegionCompletionTable() = db.withTransaction { implicit session =>

    if (regionCompletions.length.run == 0) {

      val neighborhoods: List[NamedRegion] = RegionTable.selectAllNamedNeighborhoods
      for (neighborhood <- neighborhoods) yield {

        // Check if the neighborhood is fully audited, and set audited_distance equal to total_distance if so. We are
        // doing this to fix floating point error, so that in the end, the region is marked as exactly 100% complete.
        if (StreetEdgePriorityTable.allStreetsInARegionAuditedUsingPriority(neighborhood.regionId)) {
          val totalDistance: Double = StreetEdgeTable.getTotalDistanceOfARegion(neighborhood.regionId).toDouble

          regionCompletions += RegionCompletion(neighborhood.regionId, totalDistance, totalDistance)
        } else {
          val auditedDistance: Double = StreetEdgePriorityTable.getDistanceAuditedInARegion(neighborhood.regionId).toDouble
          val totalDistance: Double = StreetEdgeTable.getTotalDistanceOfARegion(neighborhood.regionId).toDouble

          regionCompletions += RegionCompletion(neighborhood.regionId, totalDistance, auditedDistance)
        }
      }
    }
  }

  def truncateTable(): Unit = db.withTransaction { implicit session =>
    Q.updateNA("TRUNCATE TABLE region_completion").execute
  }
}
