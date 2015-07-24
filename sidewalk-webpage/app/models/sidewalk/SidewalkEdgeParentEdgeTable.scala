package models.sidewalk

import java.sql.Timestamp

import com.vividsolutions.jts.geom.LineString
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current


case class SidewalkEdgeParentEdge(sidewalkEdgeId: Int, parentEdgeId: Int)

case class SidewalkEdgeParentEdgeTable(tag: Tag) extends Table[SidewalkEdgeParentEdge](tag, Some("sidewalk"),  "sidewalk_edge_parent_edge") {
  def sidewalkEdgeId = column[Int]("sidewalk_edge_id", O.PrimaryKey, O.Default(0))
  def parentEdgeId = column[Int]("parent_edge_id")

  def * = (sidewalkEdgeId, parentEdgeId) <> ((SidewalkEdgeParentEdge.apply _).tupled, SidewalkEdgeParentEdge.unapply)
}

/**
 *
 */
object SidewalkEdgeParentEdgeTable {
  val db = play.api.db.slick.DB
  val sidewalkEdgeParentEdgeTable = TableQuery[SidewalkEdgeParentEdgeTable]

  /**
   * Get records based on the child id.
   * @param id
   * @return
   */
  def selectByChildId(id: Int): List[SidewalkEdgeParentEdge] = db.withSession { implicit session =>
    sidewalkEdgeParentEdgeTable.filter(item => item.sidewalkEdgeId === id).list
  }

  /**
   * Get records based on the parent id.
   * @param id
   * @return
   */
  def selectByParentId(id: Int): List[SidewalkEdgeParentEdge] = db.withSession { implicit session =>
    sidewalkEdgeParentEdgeTable.filter(item => item.parentEdgeId === id).list
  }

  /**
   * Save a record.
   * @param childId
   * @param parentId
   * @return
   */
  def save(childId: Int, parentId: Int) = db.withSession { implicit session =>
    sidewalkEdgeParentEdgeTable += new SidewalkEdgeParentEdge(childId, parentId)
  }
}