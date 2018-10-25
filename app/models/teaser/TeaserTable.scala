package models.teaser

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future


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
