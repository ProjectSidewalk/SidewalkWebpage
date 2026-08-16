package models.street

import com.google.inject.ImplementedBy
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}

case class StreetEdgeIssue(
    streetEdgeIssueId: Int,
    streetEdgeId: Int,
    issue: StreetEdgeIssueType.Value,
    userId: String,
    ipAddress: String,
    timestamp: OffsetDateTime
)

class StreetEdgeIssueTableDef(tag: Tag) extends Table[StreetEdgeIssue](tag, "street_edge_issue") {
  def streetEdgeIssueId: Rep[Int]           = column[Int]("street_edge_issue_id", O.PrimaryKey, O.AutoInc)
  def streetEdgeId: Rep[Int]                = column[Int]("street_edge_id")
  def issue: Rep[StreetEdgeIssueType.Value] = column[StreetEdgeIssueType.Value]("issue")
  def userId: Rep[String]                   = column[String]("user_id")
  def ipAddress: Rep[String]                = column[String]("ip_address")
  def timestamp: Rep[OffsetDateTime]        = column[OffsetDateTime]("timestamp")

  def * = (streetEdgeIssueId, streetEdgeId, issue, userId, ipAddress, timestamp) <> (
    (StreetEdgeIssue.apply _).tupled,
    StreetEdgeIssue.unapply
  )

  def streetEdge =
    foreignKey("street_edge_issue_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
  def user = foreignKey("street_edge_issue_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
}

@ImplementedBy(classOf[StreetEdgeIssueTable])
trait StreetEdgeIssueTableRepository {}

@Singleton
class StreetEdgeIssueTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends StreetEdgeIssueTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val streetEdgeIssues = TableQuery[StreetEdgeIssueTableDef]

  def insert(issue: StreetEdgeIssue): DBIO[Int] = {
    (streetEdgeIssues returning streetEdgeIssues.map(_.streetEdgeIssueId)) += issue
  }

  /**
   * Whether this user has reported the street's imagery missing during the given task.
   *
   * A true answer disqualifies the task from being resumed. A report leaves the task incomplete (#4922), and the task
   * the labeler was on is what /explore hands back on the next load — so without this check a street whose imagery
   * will not load is re-served on every reload, forever, and the labeler has no way past it.
   *
   * @param streetEdgeId The street the task covers.
   * @param userId       The labeler whose own reports count; another user's say nothing about this session.
   * @param taskStart    When the task began, so only reports from it are considered.
   * @return True when a matching PanoNotAvailable report exists.
   */
  def reportedNoImagerySince(streetEdgeId: Int, userId: String, taskStart: OffsetDateTime): DBIO[Boolean] = {
    streetEdgeIssues
      .filter(issue =>
        issue.streetEdgeId === streetEdgeId && issue.userId === userId &&
          issue.issue === StreetEdgeIssueType.PanoNotAvailable && issue.timestamp >= taskStart
      )
      .exists
      .result
  }
}
