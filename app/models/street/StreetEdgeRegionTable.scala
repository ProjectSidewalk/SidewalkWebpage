package models.street

import models.region._
//

// New
import models.utils.MyPostgresProfile
import play.api.db.slick.DatabaseConfigProvider
import javax.inject._
import play.api.db.slick.HasDatabaseConfigProvider
import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile.api._
import scala.concurrent.Future

case class StreetEdgeRegion(streetEdgeId: Int, regionId: Int)

class StreetEdgeRegionTableDef(tag: Tag) extends Table[StreetEdgeRegion](tag, "street_edge_region") {
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id")
  def regionId: Rep[Int] = column[Int]("region_id")

  def * = (streetEdgeId, regionId) <> ((StreetEdgeRegion.apply _).tupled, StreetEdgeRegion.unapply)

//  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
//    foreignKey("street_edge_region_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
//
//  def region: ForeignKeyQuery[RegionTable, Region] =
//    foreignKey("street_edge_region_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId)
}

@ImplementedBy(classOf[StreetEdgeRegionTable])
trait StreetEdgeRegionTableRepository {
}

@Singleton
class StreetEdgeRegionTable @Inject()(
                                       protected val dbConfigProvider: DatabaseConfigProvider,
                                       streetEdgeTable: StreetEdgeTable
                                     ) extends StreetEdgeRegionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  val streetEdgeRegionTable = TableQuery[StreetEdgeRegionTableDef]
  val regionTable = TableQuery[RegionTableDef]

  val regionsWithoutDeleted = regionTable.filter(_.deleted === false)
  val nonDeletedStreetEdgeRegions = for {
    _ser <- streetEdgeRegionTable
    _se <- streetEdgeTable.streetEdgesWithoutDeleted if _ser.streetEdgeId === _se.streetEdgeId
    _r <- regionsWithoutDeleted if _ser.regionId === _r.regionId
  } yield _ser

  def getNonDeletedRegionFromStreetId(streetEdgeId: Int): DBIO[Option[Region]] = {
    streetEdgeRegionTable
      .filter(_.streetEdgeId === streetEdgeId)
      .join(regionsWithoutDeleted).on(_.regionId === _.regionId)
      .map(_._2).result.headOption
  }
}
