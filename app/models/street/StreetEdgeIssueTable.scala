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
}
