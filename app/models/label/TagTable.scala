package models.label

import models.attribute.ConfigTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.cache.Cache
import scala.concurrent.duration.DurationInt
import scala.slick.lifted.{ForeignKeyQuery, Index}

case class Tag(tagId: Int, labelTypeId: Int, tag: String, mutuallyExclusiveWith: Option[String])

class TagTable(tagParam: slick.lifted.Tag) extends Table[Tag](tagParam, "tag") {
  def tagId: Column[Int] = column[Int]("tag_id", O.PrimaryKey, O.AutoInc)
  def labelTypeId: Column[Int] = column[Int]("label_type_id")
  def tag: Column[String] = column[String]("tag")
  def mutuallyExclusiveWith: Column[Option[String]] = column[Option[String]]("mutually_exclusive_with")

  def * = (tagId, labelTypeId, tag, mutuallyExclusiveWith) <> ((Tag.apply _).tupled, Tag.unapply)

  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
    foreignKey("tag_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)

  def labelTypeTagUnique: Index = index("tag_label_type_id_tag_unique", (labelTypeId, tag), unique = true)
}

object TagTable {
  val db = play.api.db.slick.DB
  val tagTable = TableQuery[TagTable]

  /**
    * Get all records.
    */
  def selectAllTags: List[Tag] = db.withSession { implicit session =>
    Cache.getOrElse("selectAllTags()") {
      tagTable.list
    }
  }

  def getTagsForCurrentCity: List[Tag] = db.withSession { implicit session =>
    Cache.getOrElse("getTagsForCurrentCity()", 3.hours.toSeconds.toInt) {
      val excludedTags: List[String] = ConfigTable.getExcludedTags
      tagTable.filterNot(_.tag inSet excludedTags).list
    }
  }

  def selectTagsByLabelType(labelType: String): List[Tag] = db.withSession { implicit session =>
    Cache.getOrElse(s"selectTagsByLabelType($labelType)") {
      tagTable
        .innerJoin(LabelTypeTable.labelTypes).on(_.labelTypeId === _.labelTypeId)
        .filter(_._2.labelType === labelType)
        .map(_._1).list
    }
  }

  def cleanTagList(tags: List[String], labelTypeId: Int): List[String] = {
    val labelType: String = LabelTypeTable.labelTypeIdToLabelType(labelTypeId).get
    cleanTagList(tags, labelType)
  }

  def cleanTagList(tags: List[String], labelType: String): List[String] = {
    val validTags = selectTagsByLabelType(labelType).map(_.tag)
    tags.map(_.toLowerCase).distinct.filter(t => validTags.contains(t))
  }
}
