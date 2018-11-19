package models.street

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class StreetEdgeParentEdge(streetEdgeId: Int, parentEdgeId: Int)

class StreetEdgeParentEdgeTable(tag: Tag) extends Table[StreetEdgeParentEdge](tag, Some("sidewalk"),  "street_edge_parent_edge") {
  def streetEdgeId = column[Int]("street_edge_id")
  def parentEdgeId = column[Int]("parent_edge_id")

  def * = (streetEdgeId, parentEdgeId) <> ((StreetEdgeParentEdge.apply _).tupled, StreetEdgeParentEdge.unapply)
}

object StreetEdgeParentEdgeTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val streetEdgeParentEdgeTable = TableQuery[StreetEdgeParentEdgeTable]

  /**
   * Get records based on the child id.
   * @param id
   * @return
   */
  def selectByChildId(id: Int): Future[List[StreetEdgeParentEdge]] = db.run(
    streetEdgeParentEdgeTable.filter(item => item.streetEdgeId === id).to[List].result
  )

  /**
   * Get records based on the parent id.
   * @param id
   * @return
   */
  def selectByParentId(id: Int): Future[List[StreetEdgeParentEdge]] = db.run(
    streetEdgeParentEdgeTable.filter(item => item.parentEdgeId === id).to[List].result
  )

  /**
   * Save a record.
   * @param childId
   * @param parentId
   * @return
   */
  def save(childId: Int, parentId: Int): Future[Int] = db.run(
    (streetEdgeParentEdgeTable += new StreetEdgeParentEdge(childId, parentId)).transactionally
  )
}
