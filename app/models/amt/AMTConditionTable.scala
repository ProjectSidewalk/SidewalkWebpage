package models.amt

/**
  * Created by manaswi on 5/5/17.
  */

import models.utils.MyPostgresDriver.simple._
import models.user.{UserRoleTable,UserRole}
import play.api.Play.current
import play.libs.Json

import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{GetResult, StaticQuery => Q}

case class AMTCondition(amtConditionId: Int, description: Option[String], parameters: String, volunteerId: String)

/**
  *
  */
class AMTConditionTable(tag: Tag) extends Table[AMTCondition](tag, Some("sidewalk"), "amt_condition") {
  def amtConditionId = column[Int]("amt_condition_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def description = column[Option[String]]("description", O.Nullable)
  def parameters = column[String]("parameters", O.NotNull)
  def volunteerId = column[String]("volunteer_id", O.NotNull)

  def * = (amtConditionId, description, parameters, volunteerId) <> ((AMTCondition.apply _).tupled, AMTCondition.unapply)

}

/**
  * Data access object for the Condition table
  */
object AMTConditionTable {
  val db = play.api.db.slick.DB
  val amtConditions = TableQuery[AMTConditionTable]
  val amtAssignments = TableQuery[AMTAssignmentTable]
  val maxNumConditionAssignments: Int = 5

  def getVolunteerIdByConditionId(amtConditionId: Int): String = db.withTransaction { implicit session =>
    val vId = amtConditions.filter(_.amtConditionId === amtConditionId).map(_.volunteerId).list.headOption
    vId.get
  }

  def assignAvailableCondition: Option[Int] =  db.withTransaction { implicit session =>
    //Get the condition id with the least number of current assignments

    val selectConditionIdQuery = Q.query[Int, Int](
      """SELECT amt_condition_id
        |  FROM (SELECT amt_condition.amt_condition_id, count(condition_id) as cnt FROM
        |  (select * from sidewalk.amt_assignment
        |  where turker_id not in ('APQS1PRMDXAFH','A1SZNIADA6B4OF','A2G18P2LDT3ZUE','AKRNZU81S71QI','A1Y6PQWK6BYEDD','TESTWORKERID')) t2
        |  Right JOIN sidewalk.amt_condition
        |  ON (t2.condition_id = amt_condition.amt_condition_id)
        |  group by amt_condition.amt_condition_id
        |  ) t1
        |  WHERE amt_condition_id not in (74, 87)
        |  and cnt<? order by cnt asc LIMIT 1;
      """.stripMargin
    )

    selectConditionIdQuery(maxNumConditionAssignments).list.headOption
  }

  def save(cond: AMTCondition): Int = db.withTransaction { implicit session =>
    val condId: Int =
      (amtConditions returning amtConditions.map(_.amtConditionId)) += cond
    condId
  }
}