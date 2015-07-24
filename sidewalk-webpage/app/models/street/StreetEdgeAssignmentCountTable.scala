package models.street

import java.sql.Timestamp

import com.vividsolutions.jts.geom.LineString
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

import play.api.db.slick._
import scala.slick.jdbc.GetResult
import scala.slick.jdbc.{StaticQuery => Q}
import play.api.Play.current

case class StreetEdgeAssignmentCount(streetEdgeAssignmentCountId: Int, streetEdgeId: Int, assignmentCount: Int, CompletionCount: Int)

class StreetEdgeAssignmentCountTable(tag: Tag) extends Table[StreetEdgeAssignmentCount](tag, Some("sidewalk"), "street_edge_assignment_count") {
  def streetEdgeAssignmentCountId = column[Int]("street_edge_assignment_count_id", O.PrimaryKey, O.AutoInc)
  def streetEdgeId = column[Int]("street_edge_id")
  def assignmentCount = column[Int]("assignment_count")
  def completionCount = column[Int]("completion_count")

  def * = (streetEdgeAssignmentCountId, streetEdgeId, assignmentCount, completionCount) <> ((StreetEdgeAssignmentCount.apply _).tupled, StreetEdgeAssignmentCount.unapply)

  def streetEdge: ForeignKeyQuery[StreetEdgeTable, StreetEdge] =
    foreignKey("street_edge_assignment_count_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTable])(_.streetEdgeId)
}

object StreetEdgeAssignmentCountTable {
  val db = play.api.db.slick.DB
  val StreetEdgeAssignmentCountTable = TableQuery[StreetEdgeAssignmentCountTable]

  implicit val streetEdgeAssignmentCountConverter = GetResult(r => {
    StreetEdgeAssignmentCount(r.<<, r.<<, r.<<, r.<<)
  })

  // An example of raw query
  // https://websketchbook.wordpress.com/2015/03/23/make-plain-sql-queries-work-with-slick-play-framework/

  val selectAssignmentQuery = Q.query[Int, StreetEdgeAssignmentCount](
    """SELECT street_edge_assignment_count_id, street_edge_id, assignment_count, completion_count
      FROM street_edge_assignment_count WHERE street_edge_id = ?"""
  )

  val selectAssignment: List[StreetEdgeAssignmentCount] = {
    DB.withSession { implicit session =>
      selectAssignmentQuery(1129144494).list
    }
  }
}