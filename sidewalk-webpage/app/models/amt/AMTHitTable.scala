package models.amt

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class AMTHit(amtHitId: Int, hitId: String)

/**
 *
 */
class AMTHitTable(tag: Tag) extends Table[AMTHit](tag, Some("sidewalk"), "amt_hit") {
  def amtHitId = column[Int]("amt_hit_id", O.PrimaryKey)
  def hitId = column[String]("hit_id", O.NotNull)

  def * = (amtHitId, hitId) <> ((AMTHit.apply _).tupled, AMTHit.unapply)
}

/**
 * Data access object for the label table
 */
object AMTHitTable {
  val db = play.api.db.slick.DB
  val amtHits = TableQuery[AMTHitTable]
}
