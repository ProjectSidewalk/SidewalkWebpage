package models.utils

import models.utils.MyPostgresProfile.api.given
import org.postgresql.ds.PGSimpleDataSource
import org.scalatest.{Args, Status, SucceededStatus}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.evolutions.*
import play.api.db.{DBApi, Database, TransactionIsolationLevel}
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

import java.sql.Connection
import scala.util.Using

/**
 * The rollback gate (#5839); the rules it enforces are in docs/evolutions.md. It rolls back whatever database it's
 * connected to, so it only runs when CI sets LAST_RELEASE_EVOLUTION and has made the second city.
 */
class EvolutionsRoundTripSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val lastRelease: Option[Int] = sys.env.get("LAST_RELEASE_EVOLUTION").map(_.trim.toInt)

  /** Without the env var there are no tests, so this skips booting an app for nothing. */
  override def run(testName: Option[String], args: Args): Status =
    if (lastRelease.isEmpty) SucceededStatus else super.run(testName, args)

  /**
   * A second city schema, which CI copies from the first. Prod runs every evolution once per city against one shared
   * sidewalk_login, so a Down or Up that only works the first time breaks cities 2 to 54. This city always goes second.
   */
  private val TwinSchema = "sidewalk_rollback_twin"

  private val PartialDownsMarker = """(?m)^\s*--\s*partial-downs:\s*\S""".r

  private lazy val config     = app.injector.instanceOf[EvolutionsConfig].forDatasource("default")
  private lazy val evolutions = app.injector.instanceOf[EvolutionsReader].evolutions("default").toSeq

  private def cityEvolutions(database: Database) = DatabaseEvolutions(database, config.schema, config.metaTable,
    config.substitutionsMappings, config.substitutionsPrefix, config.substitutionsSuffix, config.substitutionsEscape)

  private lazy val mainCity = cityEvolutions(app.injector.instanceOf[DBApi].database("default"))

  private lazy val twinCity = {
    val dataSource = PGSimpleDataSource()
    dataSource.setURL(app.configuration.get[String]("slick.dbs.default.db.url"))
    dataSource.setUser(app.configuration.get[String]("slick.dbs.default.db.user"))
    dataSource.setPassword(app.configuration.get[String]("slick.dbs.default.db.password"))
    dataSource.setCurrentSchema(s"$TwinSchema,sidewalk_login,public")
    cityEvolutions(TwinDatabase(dataSource))
  }

  /**
   * Moves both cities to `revision`, main city first, as booting the app with only the evolutions up to it on disk
   * would, so Downs come from the saved `revert_script`. Re-raises failures with the evolution and Postgres error.
   *
   * @param step What this move is, for the failure message.
   */
  private def migrateTo(revision: Int, step: String): Unit =
    Seq("" -> mainCity, s" in the second city ($TwinSchema)" -> twinCity).foreach { (where, city) =>
      val visible = SimpleEvolutionsReader(Map("default" -> evolutions.filter(_.revision <= revision)))
      try city.evolve(city.scripts(visible), config.autocommit)
      catch {
        case e: InconsistentDatabase => fail(s"$step$where failed in evolution ${e.rev}.sql: ${e.error}")
      }
    }

  /**
   * Every object in the main city schema and sidewalk_login, keyed by kind and name. Columns go by name, not
   * position, since a Down that re-adds a column puts it last.
   */
  private def schemaSnapshot(): Map[String, String] = run(sql"""
    WITH schemas AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN (current_schema(), 'sidewalk_login')),
    extension_objects AS (SELECT objid FROM pg_depend WHERE deptype = 'e')
    SELECT 'relation ' || schemas.nspname || '.' || pg_class.relname,
           pg_class.relkind::text || ' owner=' || pg_get_userbyid(pg_class.relowner)
             || ' acl=' || COALESCE(pg_class.relacl::text, '')
    FROM pg_class
    JOIN schemas ON pg_class.relnamespace = schemas.oid
    WHERE pg_class.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND pg_class.oid NOT IN (SELECT objid FROM extension_objects)
    UNION ALL
    SELECT 'column ' || schemas.nspname || '.' || pg_class.relname || '.' || pg_attribute.attname,
           format_type(pg_attribute.atttypid, pg_attribute.atttypmod)
             || CASE WHEN pg_attribute.attnotnull THEN ' not null' ELSE '' END
             || COALESCE(' default ' || pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid), '')
             || CASE WHEN pg_attribute.attidentity <> '' THEN ' identity ' || pg_attribute.attidentity::text ELSE '' END
    FROM pg_attribute
    JOIN pg_class ON pg_attribute.attrelid = pg_class.oid
    JOIN schemas ON pg_class.relnamespace = schemas.oid
    LEFT JOIN pg_attrdef ON pg_attrdef.adrelid = pg_attribute.attrelid AND pg_attrdef.adnum = pg_attribute.attnum
    WHERE pg_class.relkind IN ('r', 'p', 'v', 'm', 'f') AND pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped
      AND pg_class.oid NOT IN (SELECT objid FROM extension_objects)
    UNION ALL
    SELECT 'sequence owned by ' || schemas.nspname || '.' || pg_class.relname,
           pg_depend.refobjid::regclass::text || '.' || pg_depend.refobjsubid
    FROM pg_depend
    JOIN pg_class ON pg_depend.objid = pg_class.oid
    JOIN schemas ON pg_class.relnamespace = schemas.oid
    WHERE pg_depend.classid = 'pg_class'::regclass AND pg_depend.deptype IN ('a', 'i') AND pg_class.relkind = 'S'
    UNION ALL
    SELECT 'constraint ' || schemas.nspname || '.' || pg_class.relname || '.' || pg_constraint.conname,
           pg_get_constraintdef(pg_constraint.oid)
    FROM pg_constraint
    JOIN pg_class ON pg_constraint.conrelid = pg_class.oid
    JOIN schemas ON pg_class.relnamespace = schemas.oid
    UNION ALL
    SELECT 'domain constraint ' || schemas.nspname || '.' || pg_type.typname || '.' || pg_constraint.conname,
           pg_get_constraintdef(pg_constraint.oid)
    FROM pg_constraint
    JOIN pg_type ON pg_constraint.contypid = pg_type.oid
    JOIN schemas ON pg_type.typnamespace = schemas.oid
    UNION ALL
    SELECT 'index ' || schemas.nspname || '.' || pg_class.relname, pg_get_indexdef(pg_class.oid)
    FROM pg_index
    JOIN pg_class ON pg_index.indexrelid = pg_class.oid
    JOIN schemas ON pg_class.relnamespace = schemas.oid
    UNION ALL
    SELECT 'view ' || schemas.nspname || '.' || pg_class.relname, pg_get_viewdef(pg_class.oid)
    FROM pg_class
    JOIN schemas ON pg_class.relnamespace = schemas.oid
    WHERE pg_class.relkind IN ('v', 'm')
    UNION ALL
    SELECT 'function ' || schemas.nspname || '.' || pg_proc.proname
             || '(' || pg_get_function_identity_arguments(pg_proc.oid) || ')',
           'owner=' || pg_get_userbyid(pg_proc.proowner) || ' acl=' || COALESCE(pg_proc.proacl::text, '')
             || ' ' || pg_get_functiondef(pg_proc.oid)
    FROM pg_proc
    JOIN schemas ON pg_proc.pronamespace = schemas.oid
    WHERE pg_proc.prokind IN ('f', 'p') AND pg_proc.oid NOT IN (SELECT objid FROM extension_objects)
    UNION ALL
    SELECT 'trigger ' || schemas.nspname || '.' || pg_class.relname || '.' || pg_trigger.tgname,
           pg_get_triggerdef(pg_trigger.oid)
    FROM pg_trigger
    JOIN pg_class ON pg_trigger.tgrelid = pg_class.oid
    JOIN schemas ON pg_class.relnamespace = schemas.oid
    WHERE NOT pg_trigger.tgisinternal
    UNION ALL
    SELECT 'type ' || schemas.nspname || '.' || pg_type.typname,
           pg_type.typtype::text || ' owner=' || pg_get_userbyid(pg_type.typowner)
             || CASE WHEN pg_type.typtype = 'd' THEN ' ' || format_type(pg_type.typbasetype, pg_type.typtypmod)
                     ELSE '' END
             || COALESCE(' ' || (SELECT string_agg(pg_enum.enumlabel, ',' ORDER BY pg_enum.enumsortorder)
                                 FROM pg_enum WHERE pg_enum.enumtypid = pg_type.oid), '')
    FROM pg_type
    JOIN schemas ON pg_type.typnamespace = schemas.oid
    WHERE pg_type.typtype IN ('e', 'd') AND pg_type.oid NOT IN (SELECT objid FROM extension_objects)
  """.as[(String, String)]).toMap

  /**
   * Row count and an order-free row hash per table, summed so a big table never becomes one big string. Leaves out
   * sequence ids and play_evolutions, which a re-run Up always rewrites.
   *
   * @param withTimes Include dates and times, which a re-run Up's `now()` also rewrites but a Down must restore.
   */
  private def dataSnapshot(withTimes: Boolean): Map[String, String] = {
    val columns = run(sql"""
      SELECT quote_ident(pg_namespace.nspname) || '.' || quote_ident(pg_class.relname),
             quote_ident(pg_attribute.attname),
             pg_attribute.atttypid IN ('date'::regtype, 'timestamp'::regtype, 'timestamptz'::regtype)
      FROM pg_class
      JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
      LEFT JOIN pg_attribute ON pg_attribute.attrelid = pg_class.oid AND pg_attribute.attnum > 0
        AND NOT pg_attribute.attisdropped AND pg_attribute.attidentity = ''
        AND NOT EXISTS (
          SELECT 1 FROM pg_attrdef
          WHERE pg_attrdef.adrelid = pg_attribute.attrelid AND pg_attrdef.adnum = pg_attribute.attnum
            AND pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid) LIKE 'nextval(%'
        )
      WHERE pg_class.relkind IN ('r', 'p') AND pg_namespace.nspname IN (current_schema(), 'sidewalk_login')
        AND pg_class.relname <> 'play_evolutions'
      ORDER BY 1, 2
    """.as[(String, Option[String], Option[Boolean])])
    columns.groupBy(_._1).map { (table, rows) =>
      val values = rows.collect { case (_, Some(column), Some(isTime)) if withTimes || !isTime => column }
      val row    = if (values.isEmpty) "NULL" else values.mkString(", ")
      s"rows $table" -> run(sql"""
        SELECT count(*) || ' rows, hash '
          || COALESCE(sum(('x' || left(md5(ROW(#$row)::text), 16))::bit(64)::bigint::numeric), 0)
        FROM #$table
      """.as[String].head)
    }
  }

  private def snapshot(withData: Boolean, withTimes: Boolean): Map[String, String] =
    schemaSnapshot() ++ (if (withData) dataSnapshot(withTimes) else Map.empty)

  /** Fails listing every difference, with `hint` saying how to fix it. */
  private def assertSame(what: String, before: Map[String, String], after: Map[String, String], hint: String): Unit = {
    val diff = (before.keySet ++ after.keySet).toSeq.sorted.collect {
      case key if before.get(key) != after.get(key) =>
        s"$key\n  before: ${before.getOrElse(key, "(missing)")}\n  after:  ${after.getOrElse(key, "(missing)")}"
    }
    if (diff.nonEmpty) fail(s"$what changed the database. $hint\n${diff.mkString("\n")}")
  }

  private val MarkerHint = "If that's intended, add a `-- partial-downs: <why>` line to the Downs."

  lastRelease.foreach { released =>
    s"Rolling back to the last release (evolution $released)" should {
      "undo and redo each newer evolution cleanly, one at a time and then all at once" in {
        val head = evolutions.map(_.revision).max
        migrateTo(head, "Bringing both cities to HEAD")
        val headSchema = schemaSnapshot()

        evolutions.filter(_.revision > released).reverse.foreach { evolution =>
          val revision = evolution.revision
          val name     = s"evolution $revision.sql"
          val partial  = PartialDownsMarker.findFirstIn(evolution.sql_down).isDefined

          val atRevision = snapshot(!partial, withTimes = false)
          migrateTo(revision - 1, "Running the Downs")
          // The one check an empty Down fails: the Ups-then-Downs check below starts from what the Down left.
          if (!partial && snapshot(withData = true, withTimes = false) == atRevision)
            fail(s"Running the Downs of $name changed nothing. $MarkerHint")
          val beforeUps = snapshot(!partial, withTimes = true)
          migrateTo(revision, "Re-running the Ups after the Downs")
          assertSame(
            s"Running the Downs then the Ups of $name",
            atRevision,
            snapshot(!partial, withTimes = false),
            s"Its Downs lose something its Ups can't rebuild. $MarkerHint"
          )
          migrateTo(revision - 1, "Running the Downs a second time")
          if (!partial)
            assertSame(
              s"Running the Ups then the Downs of $name",
              beforeUps,
              snapshot(withData = true, withTimes = true),
              s"Its Downs don't undo everything its Ups do. $MarkerHint"
            )
        }

        // In one transaction per city each way, as a deploy and a rollback run them.
        migrateTo(head, "Re-applying every evolution past the last release in one batch")
        migrateTo(released, "Rolling back to the last release in one batch")
        migrateTo(head, "Re-applying every evolution past the last release in one batch, again")
        assertSame(
          "Rolling back and re-applying in batches",
          headSchema,
          schemaSnapshot(),
          "The batches end somewhere the one-at-a-time steps above didn't."
        )
      }
    }
  }
}

/** The minimum Play's evolutions need to run against [[EvolutionsRoundTripSpec]]'s second city. */
private class TwinDatabase(val dataSource: PGSimpleDataSource) extends Database {
  // The evolutions reader looks evolutions up by database name.
  val name = "default"

  def url: String = dataSource.getURL

  def getConnection(): Connection = dataSource.getConnection

  def getConnection(autocommit: Boolean): Connection = {
    val connection = dataSource.getConnection
    connection.setAutoCommit(autocommit)
    connection
  }

  def withConnection[A](block: Connection => A): A = withConnection(autocommit = true)(block)

  def withConnection[A](autocommit: Boolean)(block: Connection => A): A =
    Using.resource(getConnection(autocommit))(block)

  def withTransaction[A](block: Connection => A): A = unused

  def withTransaction[A](isolationLevel: TransactionIsolationLevel)(block: Connection => A): A = unused

  def shutdown(): Unit = ()

  private def unused = throw UnsupportedOperationException("Play's evolutions never open a transaction this way")
}
