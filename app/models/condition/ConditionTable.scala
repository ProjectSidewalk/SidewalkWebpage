package models.condition

/**
  * Created by manaswi on 5/5/17.
  */

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.libs.Json

import scala.slick.lifted.ForeignKeyQuery

case class Condition(amtConditionId: Int, description: String, parameters: Json)

/**
  *
  */
class ConditionTable(tag: Tag) extends Table[Condition](tag, Some("sidewalk"), "amt_condition") {
  def amtConditionId = column[Int]("amt_condition_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def description = column[String]("description", O.Nullable)
  def parameters = column[Json]("parameters", O.NotNull)

  def * = (amtConditionId, description, parameters) <> ((Condition.apply _).tupled, Condition.unapply)

}

/**
  * Data access object for the Condition table
  */
object ConditionTable {
  val db = play.api.db.slick.DB
  val amtConditions = TableQuery[ConditionTable]

  def save(cond: Condition): Int = db.withTransaction { implicit session =>
    val condId: Int =
      (amtConditions returning amtConditions.map(_.amtConditionId)) += cond
    condId
  }
}