package models.region

import com.google.inject.ImplementedBy
import models.street.{StreetEdgePriorityTable, StreetEdgeRegionTable, StreetEdgeRegionTableDef, StreetEdgeTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class RegionCompletion(regionId: Int, totalDistance: Double, auditedDistance: Double)
case class NamedRegionCompletion(regionId: Int, name: String, totalDistance: Double, auditedDistance: Double)

class RegionCompletionTableDef(tag: Tag) extends Table[RegionCompletion](tag, "region_completion") {
  def regionId: Rep[Int] = column[Int]("region_id", O.PrimaryKey)
  def totalDistance: Rep[Double] = column[Double]("total_distance")
  def auditedDistance: Rep[Double] = column[Double]("audited_distance")

  def * = (regionId, totalDistance, auditedDistance) <> ((RegionCompletion.apply _).tupled, RegionCompletion.unapply)
}

@ImplementedBy(classOf[RegionCompletionTable])
trait RegionCompletionTableRepository {
  def count: DBIO[Int]
}

@Singleton
class RegionCompletionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
  extends RegionCompletionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

//  implicit val regionCompletionConverter = GetResult[RegionCompletion](r => {
//    RegionCompletion(r.nextInt, r.nextDouble, r.nextDouble)
//  })
//
//  case class StreetCompletion(regionId: Int, regionName: String, streetEdgeId: Int, completionCount: Int, distance: Double)
//  implicit val streetCompletionConverter = GetResult[StreetCompletion](r => {
//    StreetCompletion(r.nextInt, r.nextString, r.nextInt, r.nextInt, r.nextDouble)
//  })

  val regionCompletions = TableQuery[RegionCompletionTableDef]
  val regions = TableQuery[RegionTableDef]
  val streetEdgeRegion = TableQuery[StreetEdgeRegionTableDef]

  val regionsWithoutDeleted = regions.filter(_.deleted === false)
//  val streetEdgeNeighborhood = for {
//    (se, n) <- streetEdgeRegion.innerJoin(regionsWithoutDeleted).on(_.regionId === _.regionId)
//  } yield se

  def count: DBIO[Int] = regionCompletions.length.result

  /**
    * Returns a list of all neighborhoods with names. If provided, filter for only given regions.
    */
  def selectAllNamedNeighborhoodCompletions(regionIds: Seq[Int]): DBIO[Seq[NamedRegionCompletion]] = {
    val namedRegionCompletions = for {
      _rc <- regionCompletions
      _r <- regionsWithoutDeleted if _rc.regionId === _r.regionId
      if (_r.regionId inSet regionIds) || regionIds.isEmpty
    } yield (_r.regionId, _r.name, _rc.totalDistance, _rc.auditedDistance)

    namedRegionCompletions.result.map(_.map(x => NamedRegionCompletion.tupled(x)))
  }

//  /**
//    * Increase the `audited_distance` column of the corresponding region by the length of the specified street edge.
//    */
//  def updateAuditedDistance(streetEdgeId: Int) = db.withTransaction { implicit session =>
//
//    val distToAdd: Float = StreetEdgeTable.getStreetEdgeDistance(streetEdgeId)
//    val regionIds: List[Int] = streetEdgeNeighborhood.filter(_.streetEdgeId === streetEdgeId).groupBy(x => x).map(_._1.regionId).list
//
//    for (regionId <- regionIds) yield {
//      val q = for {regionCompletion <- regionCompletions if regionCompletion.regionId === regionId} yield regionCompletion
//
//      val updatedDist = q.firstOption match {
//        case Some(rC) =>
//          // Check if the neighborhood is fully audited, and set audited_distance equal to total_distance if so. We are
//          // doing this to fix floating point error, so that in the end, the region is marked as exactly 100% complete.
//          // Also doing a check to see if the completion is erroneously over 100%, when the streets have not all been
//          // audited in that neighborhood; this has never been observed, but it could theoretically be an issue if there
//          // is a sizable error, while there is a single (very very short) street segment left to be audited. That case
//          // shouldn't happen, but we are just being safe, and setting audited_distance to be less than total_distance.
//          if (StreetEdgePriorityTable.allStreetsInARegionAuditedUsingPriority(regionId)) {
//            q.map(_.auditedDistance).update(rC.totalDistance)
//          } else if (rC.auditedDistance + distToAdd > rC.totalDistance) {
//            q.map(_.auditedDistance).update(rC.totalDistance * 0.995)
//          } else {
//            q.map(_.auditedDistance).update(rC.auditedDistance + distToAdd)
//          }
//        case None => -1
//      }
//    }
//  }

//  def truncateTable(): Unit = {
//    Q.updateNA("TRUNCATE TABLE region_completion").execute
//  }
}
