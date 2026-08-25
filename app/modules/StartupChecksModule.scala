package modules

import com.google.inject.AbstractModule

/** Checks that run once at boot to surface deployment-level misconfiguration the code itself can't detect (#4925). */
class StartupChecksModule extends AbstractModule {
  override def configure(): Unit = {
    bind(classOf[PersistentMediaDirCheck]).asEagerSingleton()
  }
}
