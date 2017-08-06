package models.turker

/**
  * Created by manaswi on 5/5/17.
  */

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class Turker(turkerId: String, routesAudited: String, amtConditionId: Int)
/**
  *
  */
class TurkerTable(tag: Tag) extends Table[Turker](tag, Some("sidewalk"), "turker") {
  def turkerId = column[String]("turker_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def routesAudited = column[String]("routes_audited", O.Nullable)
  def amtConditionId = column[Int]("amt_condition_id", O.NotNull)

  def * = (turkerId, routesAudited, amtConditionId) <> ((Turker.apply _).tupled, Turker.unapply)

}

/**
  * Data access object for the Turker table
  */
object TurkerTable{
  val db = play.api.db.slick.DB
  val turkers = TableQuery[TurkerTable]

  def getConditionId(turkerId: Int): Int = db.withTransaction { implicit session =>
    val cId = turkers.filter(turkerId === _.turkerId).headOption.map(_.amtConditionId)
    cId
  }

  def save(turker: Turker): String = db.withTransaction { implicit session =>
    val turkerId: String =
      (turkers returning turkers.map(_.turkerId)) += turker
    turkerId
  }
}