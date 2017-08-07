package models.amt

/**
  * Created by manaswi on 5/5/17.
  */

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.libs.Json

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

  def getVolunteerIdByConditionId(amtConditionId: Int): Option[String] = db.withTransaction { implicit session =>
    val vId = amtConditions.filter(_.amtConditionId === amtConditionId).list.headOption.map(_.volunteerId)
    vId
  }

  def save(cond: AMTCondition): Int = db.withTransaction { implicit session =>
    val condId: Int =
      (amtConditions returning amtConditions.map(_.amtConditionId)) += cond
    condId
  }
}