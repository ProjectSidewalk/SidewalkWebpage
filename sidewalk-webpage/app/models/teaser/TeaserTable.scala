package models.teaser

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current


case class Teaser(email: String)

class TeaserTable(tag: Tag) extends Table[Teaser](tag, Some("sidewalk"),  "teaser") {
  def email = column[String]("email")

  def * = email <> (Teaser.apply, Teaser.unapply)
}

object TeaserTable {
  val db = play.api.db.slick.DB
  val teaserRecords = TableQuery[TeaserTable]

  def save(email: String) = db.withTransaction { implicit session =>
    if (teaserRecords.filter(_.email === email).list.isEmpty) {
      teaserRecords += Teaser(email)
    }

  }
}
