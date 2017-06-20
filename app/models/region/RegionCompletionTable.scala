package models.region

import java.util.UUID

import com.vividsolutions.jts.geom.Polygon
import org.geotools.geometry.jts.JTS
import org.geotools.referencing.CRS

import math._
import models.street.{StreetEdgeAssignmentCountTable, StreetEdgeRegionTable, StreetEdgeTable, StreetEdge}
import models.user.UserCurrentRegionTable
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.slick.lifted.ForeignKeyQuery

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
  import MyPostgresDriver.plainImplicits._

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

  val db = play.api.db.slick.DB
  val regionCompletions = TableQuery[RegionCompletionTable]
  val regions = TableQuery[RegionTable]
  val regionTypes = TableQuery[RegionTypeTable]
  val regionProperties = TableQuery[RegionPropertyTable]
  val streetEdges = TableQuery[StreetEdgeTable]
  val streetEdgeAssignmentCounts = TableQuery[StreetEdgeAssignmentCountTable]
  val streetEdgeRegion = TableQuery[StreetEdgeRegionTable]
  val userCurrentRegions = TableQuery[UserCurrentRegionTable]

  val regionsWithoutDeleted = regions.filter(_.deleted === false)
  val streetEdgesWithoutDeleted = streetEdges.filter(_.deleted === false)
  val neighborhoods = regionsWithoutDeleted.filter(_.regionTypeId === 2)
  val streetEdgeNeighborhood = for { (se, n) <- streetEdgeRegion.innerJoin(neighborhoods).on(_.regionId === _.regionId) } yield se


  /**
    * Returns a list of all neighborhoods with names
    * @return
    */
  def selectAllNamedNeighborhoodCompletions: List[NamedRegionCompletion] = db.withSession { implicit session =>
    val namedRegionCompletions = for {
      (_neighborhoodCompletions, _regionProperties) <- regionCompletions.leftJoin(regionProperties).on(_.regionId === _.regionId)
      if _regionProperties.key === "Neighborhood Name"
    } yield (_neighborhoodCompletions.regionId, _regionProperties.value.?, _neighborhoodCompletions.totalDistance, _neighborhoodCompletions.auditedDistance)

    namedRegionCompletions.list.map(x => NamedRegionCompletion.tupled(x))
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
  def updateAuditedDistance(streetEdgeId: Int) = db.withTransaction { implicit session =>
    val distToAdd: Float = streetEdgesWithoutDeleted.filter(_.streetEdgeId === streetEdgeId).groupBy(x => x).map(_._1.geom.transform(26918).length).list.head
    val regionId: Int = streetEdgeNeighborhood.filter(_.streetEdgeId === streetEdgeId).groupBy(x => x).map(_._1.regionId).list.head

    val q = for { regionCompletion <- regionCompletions if regionCompletion.regionId === regionId } yield regionCompletion

    val updatedDist = q.firstOption match {
      case Some(rC) => q.map(_.auditedDistance).update(rC.auditedDistance + distToAdd)
      case None => -1
    }
    updatedDist
  }

  def initializeRegionCompletionTable() = db.withTransaction { implicit session =>

    if (regionCompletions.length.run == 0) {
      // http://docs.geotools.org/latest/tutorials/geometry/geometrycrs.html
      val CRSEpsg4326 = CRS.decode("epsg:4326")
      val CRSEpsg26918 = CRS.decode("epsg:26918")
      val transform = CRS.findMathTransform(CRSEpsg4326, CRSEpsg26918)

      val neighborhoods = RegionTable.selectAllNamedNeighborhoods
      for (neighborhood <- neighborhoods) yield {
        val streets: List[StreetEdge] = StreetEdgeTable.selectStreetsByARegionId(neighborhood.regionId)
        val auditedStreets: List[StreetEdge] = StreetEdgeTable.selectAuditedStreetsByARegionId(neighborhood.regionId)

        val auditedDistance = auditedStreets.map(s => JTS.transform(s.geom, transform).getLength).sum
        val totalDistance = streets.map(s => JTS.transform(s.geom, transform).getLength).sum

        regionCompletions += RegionCompletion(neighborhood.regionId, totalDistance, auditedDistance)
      }
    }
  }

//
//  /**
//    * Update the `task_end` column of the specified audit task row
//    *
//    * @param auditTaskId
//    * @param timestamp
//    * @return
//    */
//  def updateTaskEnd(auditTaskId: Int, timestamp: Timestamp) = db.withTransaction { implicit session =>
//    val q = for { task <- auditTasks if task.auditTaskId === auditTaskId } yield task.taskEnd
//    q.update(Some(timestamp))
//  }



}
