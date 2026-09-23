package modules

import com.google.inject.AbstractModule

/**
 * Runs once at boot: checks that surface deployment-level misconfiguration the code itself can't detect (#4925), and
 * repairs of per-schema state the app owns but no evolution can be relied on to have left behind (#5349). A repair
 * writes to the database, so anything added here must be idempotent and must not fail the boot.
 */
class StartupChecksModule extends AbstractModule {
  override def configure(): Unit = {
    bind(classOf[PersistentMediaDirCheck]).asEagerSingleton()
    bind(classOf[SearchIndexingCheck]).asEagerSingleton()
    bind(classOf[AiSeedRowsRepair]).asEagerSingleton()
  }
}
