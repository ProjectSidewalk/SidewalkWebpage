package models.amt

/**
  * Created by manaswi on 5/5/17.
  */

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.libs.Json


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
  val amtAssignments = TableQuery[AMTAssignment]
  val max_num_condition_assignments = 5

  def getVolunteerIdByConditionId(amtConditionId: Int): Option[String] = db.withTransaction { implicit session =>
    val vId = amtConditions.filter(_.amtConditionId === amtConditionId).list.headOption.map(_.volunteerId)
    vId
  }

  def assignAvailableCondition: Option[Int] =  db.withTransaction { implicit session =>
    //Get the condition id with the least number of current assignments
    /*SELECT amt_condition_id from (
    Select amt_condition.amt_condition_id, count(condition_id) as cnt
    from amt_assignment Right JOIN amt_condition on (amt_assignment.condition_id = amt_condition.amt_condition_id)
    group by amt_condition.amt_condition_id
    ) t1
    where cnt<5 order by cnt asc limit 1;*/
    val cId = (amtAssignments joinRight amtConditions on (_.condition_id === _.amt_condition_id)).groupBy(p => p.amt_condition_id).map{case (amt_condition_id,group) => (amt_condition_id,group.length.run)}.filter{case(amt_condition_id,count_asg) => count_asg < max_num_condition_assignments}.map(_._1).list.headOption
    cId
  }

  def save(cond: AMTCondition): Int = db.withTransaction { implicit session =>
    val condId: Int =
      (amtConditions returning amtConditions.map(_.amtConditionId)) += cond
    condId
  }
}