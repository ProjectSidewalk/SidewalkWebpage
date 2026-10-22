package executors

import org.apache.pekko.actor.ActorSystem
import play.api.libs.concurrent.CustomExecutionContext

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/**
 * Custom execution contexts for different types of operations.
 *
 * This package provides typed execution contexts to ensure proper thread pool usage across the application and to
 * prevent blocking operations from interfering with Play's default thread pool.
 */

/**
 * Execution context for CPU-intensive tasks. Managed separately to avoid blocking the main thread pool.
 *
 * Use this ExecutionContext for CPU-intensive operations like data conversion, image processing, etc. Data processed
 * using db streams use this context by default, set in the application.conf.
 */
trait CpuIntensiveExecutionContext extends ExecutionContext

object CpuIntensiveExecutionContext {
  @Singleton
  class PekkoBased @Inject() (system: ActorSystem)
      extends CustomExecutionContext(system, "cpu-intensive")
      with CpuIntensiveExecutionContext
}

/**
 * Execution context for blocking filesystem operations, isolated so that a call that never returns — a stat or a
 * directory listing against an unreachable network mount — can only exhaust this pool and not the ones serving
 * requests or running streams.
 */
trait BlockingIoExecutionContext extends ExecutionContext

object BlockingIoExecutionContext {
  @Singleton
  class PekkoBased @Inject() (system: ActorSystem)
      extends CustomExecutionContext(system, "blocking-io")
      with BlockingIoExecutionContext
}
