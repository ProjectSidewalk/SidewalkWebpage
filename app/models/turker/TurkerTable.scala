package models.turker

/**
  * Created by manaswi on 5/5/17.
  */

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class Turker(turkerId: String, routesAudited: String)
/**
  *
  */
class TurkerTable(tag: Tag) extends Table[Turker](tag, Some("sidewalk"), "turker") {
  def turkerId = column[String]("turker_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def routesAudited = column[String]("routes_audited", O.Nullable)

  def * = (turkerId, routesAudited) <> ((Turker.apply _).tupled, Turker.unapply)

}

/**
  * Data access object for the Turker table
  */
object TurkerTable{
  val db = play.api.db.slick.DB
  val turkers = TableQuery[TurkerTable]

  def save(turkId: Turker): String = db.withTransaction { implicit session =>
    val turkerId: String =
      (turkers returning turkers.map(_.turkerId)) += turkId
    turkerId
  }
}