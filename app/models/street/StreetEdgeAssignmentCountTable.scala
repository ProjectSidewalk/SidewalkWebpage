package models.street

import models.audit.AuditTaskTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

import play.api.db.slick._
import scala.slick.jdbc.GetResult
import scala.slick.jdbc.{StaticQuery => Q}

case class StreetEdgeAssignmentCount(streetEdgeAssignmentCountId: Int, streetEdgeId: Int, assignmentCount: Int, completionCount: Int)
case class CompletionCount(regionId: Int, streetEdgeId: Int, completionCount: Int)
case class CompletionRate(regionId: Int, rate: Double)

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
  val streetEdgeAssignmentCounts = TableQuery[StreetEdgeAssignmentCountTable]

  // An example of raw query
  // https://websketchbook.wordpress.com/2015/03/23/make-plain-sql-queries-work-with-slick-play-framework/
  implicit val streetEdgeAssignmentCountConverter = GetResult(r => {
    StreetEdgeAssignmentCount(r.<<, r.<<, r.<<, r.<<)
  })

  implicit val completionCountConverter = GetResult(r => {
    CompletionCount(r.nextInt, r.nextInt, r.nextInt)
  })

  def computeEdgeCompletionCounts: Query[(Column[Int], Column[Int]), (Int, Int), Seq] = db.withTransaction { implicit session =>
    val nonZeroCompletionCounts = (for {
      _tasks <- AuditTaskTable.completedTasks
      _edges <- StreetEdgeTable.streetEdgesWithoutDeleted if _edges.streetEdgeId === _tasks.streetEdgeId
    } yield _edges).groupBy(x => x).map{ case (edge, group) => (edge.streetEdgeId, group.length)}

    for {
      (_edges, _counts) <- StreetEdgeTable.streetEdgesWithoutDeleted.leftJoin(nonZeroCompletionCounts).on(_.streetEdgeId === _._1)
    } yield (_edges.streetEdgeId, _counts._2.?.getOrElse(0))
  }

  /**
   * Increment the assignmentCount field
    *
    * @param edgeId Street edge id
   * @return
   */
  def incrementAssignment(edgeId: Int): Int = db.withTransaction { implicit session =>
    val q = for {counts <- streetEdgeAssignmentCounts if counts.streetEdgeId === edgeId} yield counts
    val count = q.firstOption match {
      case Some(c) => q.map(_.assignmentCount).update(c.assignmentCount + 1)
      case None => 0
    }
    count
  }

  /**
   * Increment the completionCount column
   *
   * Reference for updating a table column
   * http://slick.typesafe.com/doc/2.1.0/queries.html
    *
    * @param edgeId Street edge id
   * @return
   */
  def incrementCompletion(edgeId: Int): Int = db.withTransaction { implicit session =>
    val q = for {counts <- streetEdgeAssignmentCounts if counts.streetEdgeId === edgeId} yield counts
    val count = q.firstOption match {
      case Some(c) => q.map(_.completionCount).update(c.completionCount + 1); c.completionCount + 1 // returns incremented completion count
      case None => 0
    }
    count
  }

  /**
    * This method returns how many times streets are audited
    * @return
    */
  def selectCompletionCount: List[CompletionCount] = db.withSession { implicit session =>
    val selectCompletionCountQuery =  Q.queryNA[CompletionCount](
      """SELECT region.region_id, street_edge.street_edge_id, street_edge_assignment_count.completion_count
        |  FROM sidewalk.region
        |INNER JOIN sidewalk.street_edge_region
        |  ON street_edge_region.region_id = region.region_id
        |INNER JOIN sidewalk.street_edge
        |  ON street_edge.street_edge_id = street_edge_region.street_edge_id
        |INNER JOIN street_edge_assignment_count
        |  ON street_edge_assignment_count.street_edge_id = street_edge.street_edge_id
        |WHERE region.deleted = FALSE
        |  AND region.region_type_id = 2
        |  AND street_edge.deleted = FALSE""".stripMargin
    )
    selectCompletionCountQuery.list
  }

  /**
    * This method returns a completion rate for each neighborhood
    * @param auditCount Minimum number of audit counts needs to be considered as completed
    * @return
    */
  def computeNeighborhoodCompletionRate(auditCount: Int): List[CompletionRate] = {
    val completionCount = selectCompletionCount
    val grouped = completionCount.groupBy(_.regionId)
    val completed = completionCount.filter(_.completionCount >= auditCount)
    val completedGroup = completed.groupBy(_.regionId)

    val completionRates = for ((regionId, records) <- grouped) yield {

      val numerator = if (completedGroup.contains(regionId)) completedGroup(regionId).size.toDouble else 0.0
      val denominator = records.size
      CompletionRate(regionId, numerator / denominator)
    }
    completionRates.toList
  }
}