package models.utils

import models.utils.MyPostgresProfile.api.given
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.evolutions.*
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

/**
 * The rollback gate (#5839): every evolution newer than the last release must survive its Downs, then its Ups, with
 * schema and data unchanged. Deploying an older tag runs those Downs unattended in every city. See docs/evolutions.md.
 *
 * It rolls back whatever database it's connected to, so it only runs when CI sets LAST_RELEASE_EVOLUTION.
 */
class EvolutionsRoundTripSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val lastRelease: Option[Int] = sys.env.get("LAST_RELEASE_EVOLUTION").map(_.trim.toInt)

  private val LossyDownsMarker = """(?m)^\s*--\s*lossy-downs:\s*\S""".r

  private lazy val evolutionsApi = app.injector.instanceOf[EvolutionsApi]
  private lazy val config        = app.injector.instanceOf[EvolutionsConfig].forDatasource("default")
  private lazy val evolutions    = app.injector.instanceOf[EvolutionsReader].evolutions("default").toSeq

  /**
   * Moves the schema to `revision` as booting the app with only evolutions up to it on disk would, so Downs come from
   * the saved `revert_script`, as in a rollback. Re-raises failures with the evolution and Postgres error Play hides.
   *
   * @param step What this move is, for the failure message.
   */
  private def migrateTo(revision: Int, step: String): Unit = {
    val visible = SimpleEvolutionsReader(Map("default" -> evolutions.filter(_.revision <= revision)))
    val scripts = evolutionsApi.scripts("default", visible, config.schema, config.metaTable)
    try {
      evolutionsApi.evolve("default", scripts, config.autocommit, config.schema, config.metaTable,
        config.substitutionsMappings, config.substitutionsPrefix, config.substitutionsSuffix,
        config.substitutionsEscape)
    } catch {
      case e: InconsistentDatabase => fail(s"$step failed in evolution ${e.rev}.sql: ${e.error}")
    }
  }

  /**
   * Every object in the city schema and sidewalk_login, keyed by kind and name. Columns go by name, not position,
   * since a Down that re-adds a column puts it last.
   */
  private def schemaSnapshot(): Map[String, String] = run(sql"""
    WITH s AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN (current_schema(), 'sidewalk_login')),
    ext AS (SELECT objid FROM pg_depend WHERE deptype = 'e')
    SELECT 'relation ' || s.nspname || '.' || c.relname,
           c.relkind::text || ' owner=' || pg_get_userbyid(c.relowner) || ' acl=' || COALESCE(c.relacl::text, '')
    FROM pg_class c
    JOIN s ON c.relnamespace = s.oid
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND c.oid NOT IN (SELECT objid FROM ext)
    UNION ALL
    SELECT 'column ' || s.nspname || '.' || c.relname || '.' || a.attname,
           format_type(a.atttypid, a.atttypmod)
             || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
             || COALESCE(' default ' || pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid), '')
             || CASE WHEN a.attidentity <> '' THEN ' identity ' || a.attidentity::text ELSE '' END
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN s ON c.relnamespace = s.oid
    LEFT JOIN pg_attrdef ON pg_attrdef.adrelid = a.attrelid AND pg_attrdef.adnum = a.attnum
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.attnum > 0 AND NOT a.attisdropped
      AND c.oid NOT IN (SELECT objid FROM ext)
    UNION ALL
    SELECT 'constraint ' || s.nspname || '.' || c.relname || '.' || con.conname, pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    JOIN pg_class c ON con.conrelid = c.oid
    JOIN s ON c.relnamespace = s.oid
    UNION ALL
    SELECT 'index ' || s.nspname || '.' || i.relname, pg_get_indexdef(i.oid)
    FROM pg_index x
    JOIN pg_class i ON x.indexrelid = i.oid
    JOIN s ON i.relnamespace = s.oid
    UNION ALL
    SELECT 'view ' || s.nspname || '.' || c.relname, pg_get_viewdef(c.oid)
    FROM pg_class c
    JOIN s ON c.relnamespace = s.oid
    WHERE c.relkind IN ('v', 'm')
    UNION ALL
    SELECT 'function ' || s.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN s ON p.pronamespace = s.oid
    WHERE p.prokind IN ('f', 'p') AND p.oid NOT IN (SELECT objid FROM ext)
    UNION ALL
    SELECT 'trigger ' || s.nspname || '.' || c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN s ON c.relnamespace = s.oid
    WHERE NOT t.tgisinternal
    UNION ALL
    SELECT 'type ' || s.nspname || '.' || t.typname,
           t.typtype::text || ' owner=' || pg_get_userbyid(t.typowner)
             || CASE WHEN t.typtype = 'd' THEN ' ' || format_type(t.typbasetype, t.typtypmod) ELSE '' END
             || COALESCE(' ' || (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
                                 FROM pg_enum e WHERE e.enumtypid = t.oid), '')
    FROM pg_type t
    JOIN s ON t.typnamespace = s.oid
    WHERE t.typtype IN ('e', 'd') AND t.oid NOT IN (SELECT objid FROM ext)
  """.as[(String, String)]).toMap

  /**
   * Row count and row hash per table. Skips what a re-run Up rewrites: sequence ids, dates/times (every release's
   * `version` row uses now()), and play_evolutions.
   */
  private def dataSnapshot(): Map[String, String] = {
    val tables = run(sql"""
      SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname),
             COALESCE(string_agg(quote_ident(a.attname), ', ' ORDER BY a.attname), 'NULL')
      FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attidentity = ''
        AND a.atttypid NOT IN ('date'::regtype, 'timestamp'::regtype, 'timestamptz'::regtype, 'time'::regtype,
                               'timetz'::regtype)
        AND NOT EXISTS (
          SELECT 1 FROM pg_attrdef
          WHERE pg_attrdef.adrelid = a.attrelid AND pg_attrdef.adnum = a.attnum
            AND pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid) LIKE 'nextval(%'
        )
      WHERE c.relkind IN ('r', 'p') AND n.nspname IN (current_schema(), 'sidewalk_login')
        AND c.relname <> 'play_evolutions'
      GROUP BY n.nspname, c.relname
    """.as[(String, String)])
    tables.map { (table, columns) =>
      table -> run(sql"""
        SELECT count(*) || ' rows, md5 ' || md5(COALESCE(string_agg(r, chr(10) ORDER BY r), ''))
        FROM (SELECT ROW(#$columns)::text AS r FROM #$table) rows
      """.as[String].head)
    }.toMap
  }

  /** One line per key whose value differs between the two snapshots, empty when they match. */
  private def differences(before: Map[String, String], after: Map[String, String]): Seq[String] =
    (before.keySet ++ after.keySet).toSeq.sorted.collect {
      case key if before.get(key) != after.get(key) =>
        s"$key\n  before: ${before.getOrElse(key, "(missing)")}\n  after:  ${after.getOrElse(key, "(missing)")}"
    }

  /** Fails listing every difference, with `hint` saying how to fix it. */
  private def assertSame(what: String, before: Map[String, String], after: Map[String, String], hint: String): Unit = {
    val diff = differences(before, after)
    if (diff.nonEmpty) fail(s"$what differs after the round trip. $hint\n${diff.mkString("\n")}")
  }

  lastRelease.foreach { released =>
    s"Rolling back to the last release (evolution $released)" should {
      "run each newer evolution's Downs then Ups, and re-apply them all, leaving the schema and data as they were" in {
        val head         = evolutions.map(_.revision).max
        val newRevisions = evolutions.filter(_.revision > released).reverse
        val headSchema   = schemaSnapshot()
        if (newRevisions.isEmpty) info(s"nothing to check: HEAD ($head) is not past the last release")

        newRevisions.foreach { evolution =>
          val revision = evolution.revision
          val lossy    = LossyDownsMarker.findFirstIn(evolution.sql_down).isDefined
          val schema   = schemaSnapshot()
          val data     = if (lossy) Map.empty else dataSnapshot()

          migrateTo(revision - 1, "Running the Downs")
          migrateTo(revision, "Re-running the Ups after the Downs")
          assertSame(
            s"In evolution $revision.sql, the schema",
            schema,
            schemaSnapshot(),
            "Its Downs must undo exactly what its Ups do."
          )
          if (!lossy)
            assertSame(
              s"In evolution $revision.sql, the data",
              data,
              dataSnapshot(),
              "If its Downs can't keep this data, add a `-- lossy-downs: <why>` line to them."
            )

          // The next-older evolution's turn starts from where a rollback would leave it.
          migrateTo(revision - 1, "Running the Downs a second time")
        }

        migrateTo(head, "Re-applying every evolution past the last release in one batch")
        assertSame("The schema at HEAD", headSchema, schemaSnapshot(), "Some evolution's Downs leave something behind.")
      }
    }
  }
}
