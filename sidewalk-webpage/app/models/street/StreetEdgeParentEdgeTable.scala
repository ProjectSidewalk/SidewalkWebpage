package models.street

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class StreetEdgeParentEdge(streetEdgeId: Int, parentEdgeId: Int)

class StreetEdgeParentEdgeTable(tag: Tag) extends Table[StreetEdgeParentEdge](tag, Some("sidewalk"),  "street_edge_parent_edge") {
  def streetEdgeId = column[Int]("street_edge_id")
  def parentEdgeId = column[Int]("parent_edge_id")

  def * = (streetEdgeId, parentEdgeId) <> ((StreetEdgeParentEdge.apply _).tupled, StreetEdgeParentEdge.unapply)
}

object StreetEdgeParentEdgeTable {
  val db = play.api.db.slick.DB
  val streetEdgeParentEdgeTable = TableQuery[StreetEdgeParentEdgeTable]

  /**
   * Get records based on the child id.
   * @param id
   * @return
   */
  def selectByChildId(id: Int): List[StreetEdgeParentEdge] = db.withSession { implicit session =>
    streetEdgeParentEdgeTable.filter(item => item.streetEdgeId === id).list
  }

  /**
   * Get records based on the parent id.
   * @param id
   * @return
   */
  def selectByParentId(id: Int): List[StreetEdgeParentEdge] = db.withSession { implicit session =>
    streetEdgeParentEdgeTable.filter(item => item.parentEdgeId === id).list
  }

  /**
   * Save a record.
   * @param childId
   * @param parentId
   * @return
   */
  def save(childId: Int, parentId: Int) = db.withSession { implicit session =>
    streetEdgeParentEdgeTable += new StreetEdgeParentEdge(childId, parentId)
  }
}
