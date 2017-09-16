package models.amt

import java.sql.Timestamp

import models.audit.AuditTaskTable
import models.clustering_session.LabelsForResolution
import models.label.{LabelTable, ProblemDescriptionTable, ProblemTemporarinessTable}
import models.route.{Route, RouteTable}
import models.turker.{TurkerTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class AMTAssignment(amtAssignmentId: Int, hitId: String, assignmentId: String,
                         assignmentStart: Timestamp, assignmentEnd: Option[Timestamp],
                         turkerId: String, conditionId: Int, routeId: Option[Int], completed: Boolean)

/**
 *
 */
class AMTAssignmentTable(tag: Tag) extends Table[AMTAssignment](tag, Some("sidewalk"), "amt_assignment") {
  def amtAssignmentId = column[Int]("amt_assignment_id", O.PrimaryKey, O.AutoInc)
  def hitId = column[String]("hit_id", O.NotNull)
  def assignmentId = column[String]("assignment_id", O.NotNull)
  def assignmentStart = column[Timestamp]("assignment_start", O.NotNull)
  def assignmentEnd = column[Option[Timestamp]]("assignment_end", O.Nullable)
  def turkerId = column[String]("turker_id", O.NotNull)
  def conditionId = column[Int]("condition_id", O.NotNull)
  def routeId = column[Option[Int]]("route_id", O.NotNull)
  def completed = column[Boolean]("completed", O.NotNull)

  def * = (amtAssignmentId, hitId, assignmentId, assignmentStart, assignmentEnd, turkerId, conditionId, routeId,
    completed) <> ((AMTAssignment.apply _).tupled, AMTAssignment.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] =
    foreignKey("amt_assignment_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)

  def condition: ForeignKeyQuery[AMTConditionTable, AMTCondition] =
    foreignKey("amt_assignment_condition_id_fkey", conditionId, TableQuery[AMTConditionTable])(_.amtConditionId)

//  def turker: ForeignKeyQuery[TurkerTable, Turker] =
//    foreignKey("amt_assignment_turker_id_fkey", turkerId, TableQuery[TurkerTable])(_.turkerId)
}

/**
 * Data access object for the AMTAssignment table
 */
object AMTAssignmentTable {
  val db = play.api.db.slick.DB
  val amtAssignments = TableQuery[AMTAssignmentTable]


  /**
    * Returns the set of labels placed by a single GT labeler for the specified condition.
    *
    * @param conditionId
    * @return
    */
  def getLabelsFromGTLabelers(conditionId: Int): List[LabelsForResolution] = db.withTransaction { implicit session =>
    val turkers: Option[String] = getGTLabelerTurkersWhoCompletedCondition(conditionId).headOption
    val nonOnboardingLabs = LabelTable.labelsWithoutDeleted.filterNot(_.gsvPanoramaId === "stxXyCKAbd73DmkM2vsIHA")

    // Does a bunch of inner joins to go from amt_assignment table to label tables.
    val labels = for {
      _asmts <- amtAssignments.filter(asmt => asmt.turkerId === turkers && asmt.conditionId === conditionId)
      _tasks <- AuditTaskTable.auditTasks if _asmts.amtAssignmentId === _tasks.amtAssignmentId
      _labs <- nonOnboardingLabs if _tasks.auditTaskId === _labs.auditTaskId
      _latlngs <- LabelTable.labelPoints if _labs.labelId === _latlngs.labelId
      _labPoints <- LabelTable.labelPoints if _labs.labelId === _labPoints.labelId
      _types <- LabelTable.labelTypes if _labs.labelTypeId === _types.labelTypeId
    } yield (_labs.labelId, -1, _asmts.routeId, _asmts.turkerId, _labs.gsvPanoramaId, _types.labelType,
      _labPoints.svImageX, _labPoints.svImageY, _labPoints.canvasX, _labPoints.canvasY, _labPoints.heading,
      _labPoints.pitch, _labPoints.zoom, _labPoints.canvasHeight, _labPoints.canvasWidth, _labPoints.alphaX,
      _labPoints.alphaY, _labPoints.lat, _labPoints.lng)

    // Left joins to get descriptions for any labels that have them
    val labelsWithDescription = for {
      (_labs, _descriptions) <- labels.leftJoin(ProblemDescriptionTable.problemDescriptions).on(_._1 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _labs._5, _labs._6, _labs._7, _labs._8, _labs._9, _labs._10,
      _labs._11, _labs._12, _labs._13, _labs._14, _labs._15, _labs._16, _labs._17, _labs._18, _labs._19,
      _descriptions.description.?)

    // Left joins to get severity for any labels that have them
    val labelsWithSeverity = for {
      (_labs, _severity) <- labelsWithDescription.leftJoin(LabelTable.severities).on(_._1 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _labs._5, _labs._6, _labs._7, _labs._8, _labs._9, _labs._10,
      _labs._11, _labs._12, _labs._13, _labs._14, _labs._15, _labs._16, _labs._17, _labs._18, _labs._19, _labs._20,
      _severity.severity.?)

    // Left joins to get temporariness for any labels that have them (those that don't are marked as temporary=false)
    val labelsWithTemporariness = for {
      (_labs, _temporariness) <- labelsWithSeverity.leftJoin(ProblemTemporarinessTable.problemTemporarinesses).on(_._1 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _labs._5, _labs._6, _labs._7, _labs._8, _labs._9, _labs._10,
      _labs._11, _labs._12, _labs._13, _labs._14, _labs._15, _labs._16, _labs._17, _labs._18, _labs._19, _labs._20,
      _labs._21, _temporariness.temporaryProblem.?)

    labelsWithTemporariness.list.map(x =>
      LabelsForResolution.tupled((x._1, x._2, x._3.get, x._4, x._5, x._6, x._7, x._8, x._9, x._10, x._11, x._12, x._13,
        x._14, x._15, x._16, x._17, x._18, x._19, x._20, x._21, x._22.getOrElse(false))))
  }

  /**
    * Returns list of non-researcher turker ids for those who have completed all routes in the specified condition.
    *
    * @param conditionId
    * @return
    */
  def getNonResearcherTurkersWhoCompletedCondition(conditionId: Int): List[String] = db.withSession { implicit session =>
    // figure out number of routes in the condition
    val nRoutes: Int = (for {
      _condition <- AMTConditionTable.amtConditions if _condition.amtConditionId === conditionId
      _routes <- AMTVolunteerRouteTable.amtVolunteerRoutes if _routes.volunteerId === _condition.volunteerId
    } yield _routes).length.run

    // find all (non-researcher) turkers who have completed all of the routes
    val completedAsmts = AMTAssignmentTable.amtAssignments.filter(asmt => asmt.completed && asmt.conditionId === conditionId)
    val routeCounts = completedAsmts.groupBy(_.turkerId).map { case (id, group) => (id, group.length) }
    routeCounts.filter(_._2 === nRoutes).filterNot(_._1 inSet TurkerTable.researcherTurkerIds).map(_._1).list
  }

  /**
    * Returns list of GT labelers' turker ids for those who have completed all routes in the specified condition.
    *
    * @param conditionId
    * @return
    */
  def getGTLabelerTurkersWhoCompletedCondition(conditionId: Int): List[String] = db.withSession { implicit session =>
    // figure out number of routes in the condition
    val nRoutes: Int = (for {
      _condition <- AMTConditionTable.amtConditions if _condition.amtConditionId === conditionId
      _routes <- AMTVolunteerRouteTable.amtVolunteerRoutes if _routes.volunteerId === _condition.volunteerId
    } yield _routes).length.run

    // find all turkers who were GT labelers who have completed all of the routes
    val completedAsmts = AMTAssignmentTable.amtAssignments.filter(asmt => asmt.completed && asmt.conditionId === conditionId)
    val routeCounts = completedAsmts.groupBy(_.turkerId).map { case (id, group) => (id, group.length) }
    routeCounts.filter(_._2 === nRoutes).filter(_._1 inSet TurkerTable.gtTurkerIds).map(_._1).list
  }


  def save(asg: AMTAssignment): Int = db.withTransaction { implicit session =>
    val asgId: Int =
      (amtAssignments returning amtAssignments.map(_.amtAssignmentId)) += asg
    asgId
  }

  /**
    * Update the `completed` column of the specified assignment row.
    * Reference: http://slick.lightbend.com/doc/2.0.0/queries.html#updating
    *
    * @param amtAssignmentId AMT Assignment id
    * @param completed A completed flag
    * @return
    */
  def updateCompleted(amtAssignmentId: Int, completed: Boolean) = db.withTransaction { implicit session =>
    val q = for { asg <- amtAssignments if asg.amtAssignmentId === amtAssignmentId } yield asg.completed
    q.update(completed)
  }

  def getCountOfCompletedByTurkerId(turkerId: String): Int = db.withTransaction { implicit session =>
    val conditionId = TurkerTable.getConditionIdByTurkerId(turkerId).get
    amtAssignments.filter(x => x.turkerId === turkerId && x.completed === true && x.conditionId === conditionId).length.run
  }

  /**
    * Update the `assignment_end` timestamp column of the specified amt_assignment row
    *
    * @param amtAssignmentId
    * @param timestamp
    * @return
    */
  def updateAssignmentEnd(amtAssignmentId: Int, timestamp: Timestamp) = db.withTransaction { implicit session =>
    val q = for { asg <- amtAssignments if asg.amtAssignmentId === amtAssignmentId } yield asg.assignmentEnd
    q.update(Some(timestamp))
  }
}

