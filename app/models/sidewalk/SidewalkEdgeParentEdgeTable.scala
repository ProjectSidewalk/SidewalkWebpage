package models.sidewalk

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future


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
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val sidewalkEdgeParentEdgeTable = TableQuery[SidewalkEdgeParentEdgeTable]

  /**
   * Get records based on the child id.
   * @param id
   * @return
   */
  def selectByChildId(id: Int): Future[Seq[SidewalkEdgeParentEdge]] = db.run {
    sidewalkEdgeParentEdgeTable.filter(item => item.sidewalkEdgeId === id).result
  }

  /**
   * Get records based on the parent id.
   * @param id
   * @return
   */
  def selectByParentId(id: Int): Future[Seq[SidewalkEdgeParentEdge]] = db.run {
    sidewalkEdgeParentEdgeTable.filter(item => item.parentEdgeId === id).result
  }

  /**
   * Save a record.
   * @param childId
   * @param parentId
   * @return
   */
  def save(childId: Int, parentId: Int): Future[Int] = db.run {
    sidewalkEdgeParentEdgeTable += SidewalkEdgeParentEdge(childId, parentId)
  }
}