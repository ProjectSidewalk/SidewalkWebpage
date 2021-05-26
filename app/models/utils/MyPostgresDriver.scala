package models.utils

import com.github.tminglei.slickpg._
import slick.driver.{PostgresDriver, JdbcDriver}

trait WithMyDriver {
  val driver: MyPostgresDriver
}

////////////////////////////////////////////////////////////
trait MyPostgresDriver extends JdbcDriver with PostgresDriver
with PgArraySupport
with PgDateSupportJoda
with PgRangeSupport
with PgHStoreSupport
with PgPlayJsonSupport
with PgSearchSupport
with PgPostGISSupport {
  override val pgjson = "jsonb" //to keep back compatibility, pgjson's value was "json" by default

  override lazy val Implicit = new ImplicitsPlus {}
  override val simple = new SimpleQLPlus {}

  trait ImplicitsPlus extends Implicits
  with ArrayImplicits
  with DateTimeImplicits
  with RangeImplicits
  with HStoreImplicits
  with JsonImplicits
  with SearchImplicits
  with PostGISImplicits

  trait SimpleQLPlus extends SimpleQL
  with ImplicitsPlus
  with SearchAssistants
  with PostGISAssistants
}

object MyPostgresDriver extends MyPostgresDriver with PgPostGISSupport {

  // For plain query
  // https://github.com/tminglei/slick-pg/blob/slick2/src/test/scala/com/github/tminglei/slickpg/addon/PgPostGISSupportTest.scala
  override lazy val Implicit = new ImplicitsPlus with PostGISImplicits
  override val simple = new Implicits with SimpleQLPlus with PostGISImplicits with PostGISAssistants

  val plainImplicits = new Implicits with PostGISPlainImplicits
}
