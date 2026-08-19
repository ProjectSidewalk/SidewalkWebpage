package modules

import com.google.inject.AbstractModule
import executors._

/**
 * Module for binding custom execution contexts.
 */
class ExecutorsModule extends AbstractModule {
  override def configure(): Unit = {
    bind(classOf[CpuIntensiveExecutionContext]).to(classOf[CpuIntensiveExecutionContext.PekkoBased]).asEagerSingleton()
    bind(classOf[BlockingIoExecutionContext]).to(classOf[BlockingIoExecutionContext.PekkoBased]).asEagerSingleton()
  }
}
