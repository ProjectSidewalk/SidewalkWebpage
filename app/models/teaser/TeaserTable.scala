package models.teaser

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global


case class Teaser(email: String)

class TeaserTable(tag: Tag) extends Table[Teaser](tag, Some("sidewalk"),  "teaser") {
  def email = column[String]("email")

  def * = email <> (Teaser.apply, Teaser.unapply)
}

object TeaserTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val teaserRecords = TableQuery[TeaserTable]

  def save(email: String): Future[Int] = {
    val existingRecord: Future[List[Teaser]] = db.run(teaserRecords.filter(_.email === email).result)
    existingRecord.flatMap { teaserList =>
      if (teaserList.isEmpty) db.run(teaserRecords += Teaser(email)) else 0
    }
  }
}
