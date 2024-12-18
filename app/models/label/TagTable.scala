package models.label

import com.google.inject.ImplementedBy
import models.utils.{ConfigTableDef, MyPostgresDriver}
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Logger
import play.api.Play.current
import play.api.cache.Cache

import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.DurationInt

case class Tag(tagId: Int, labelTypeId: Int, tag: String, mutuallyExclusiveWith: Option[String])

class TagTableDef(tagParam: slick.lifted.Tag) extends Table[Tag](tagParam, "tag") {
  def tagId: Rep[Int] = column[Int]("tag_id", O.PrimaryKey, O.AutoInc)
  def labelTypeId: Rep[Int] = column[Int]("label_type_id")
  def tag: Rep[String] = column[String]("tag")
  def mutuallyExclusiveWith: Rep[Option[String]] = column[Option[String]]("mutually_exclusive_with")

  def * = (tagId, labelTypeId, tag, mutuallyExclusiveWith) <> ((Tag.apply _).tupled, Tag.unapply)

//  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
//    foreignKey("tag_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTableDef])(_.labelTypeId)
//
//  def labelTypeTagUnique: Index = index("tag_label_type_id_tag_unique", (labelTypeId, tag), unique = true)
}

@ImplementedBy(classOf[TagTable])
trait TagTableRepository {
}

@Singleton
class TagTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends TagTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val tagTable = TableQuery[TagTableDef]

  /**
    * Get all records.
    */
//  def selectAllTags: List[Tag] = {
//    Cache.getOrElse("selectAllTags()") {
//      tagTable.list
//    }
//  }
//
//  def getTagsForCurrentCity: List[Tag] = {
//    Cache.getOrElse("getTagsForCurrentCity()", 3.hours.toSeconds.toInt) {
//      val excludedTags: List[String] = ConfigTable.getExcludedTags
//      tagTable.filterNot(_.tag inSet excludedTags).list
//    }
//  }
//
//  def selectTagsByLabelTypeId(labelTypeId: Int): List[Tag] = {
//    Cache.getOrElse(s"selectTagsByLabelTypeId($labelTypeId)") {
//      tagTable.filter(_.labelTypeId === labelTypeId).list
//    }
//  }
//
//  def selectTagsByLabelType(labelType: String): List[Tag] = {
//    Cache.getOrElse(s"selectTagsByLabelType($labelType)") {
//      tagTable
//        .innerJoin(LabelTypeTable.labelTypes).on(_.labelTypeId === _.labelTypeId)
//        .filter(_._2.labelType === labelType)
//        .map(_._1).list
//    }
//  }
//
//  def cleanTagList(tags: List[String], labelTypeId: Int): List[String] = {
//    val validTags: List[String] = selectTagsByLabelTypeId(labelTypeId).map(_.tag)
//    val cleanedTags: List[String] = tags.map(_.toLowerCase).distinct.filter(t => validTags.contains(t))
//    val conflictingTags: List[String] = findConflictingTags(cleanedTags.toSet, labelTypeId)
//    if (conflictingTags.nonEmpty) {
//      Logger.warn(s"Tag list contains conflicting tags, removing all that conflict: ${conflictingTags.mkString(", ")}")
//      cleanedTags.filterNot(conflictingTags.contains)
//    } else {
//      cleanedTags
//    }
//  }
//
//  def cleanTagList(tags: List[String], labelType: String): List[String] = {
//    val labelTypeId: Int = LabelTypeTable.labelTypeToId(labelType).get
//    cleanTagList(tags, labelTypeId)
//  }
//
//  def findConflictingTags(tags: Set[String], labelTypeId: Int): List[String] = {
//    val allTags: List[Tag] = selectTagsByLabelTypeId(labelTypeId)
//    allTags.filter(tag => tags.contains(tag.tag) && tag.mutuallyExclusiveWith.exists(tags.contains)).map(_.tag)
//  }
}
