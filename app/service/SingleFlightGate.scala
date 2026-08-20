package service

import java.util.concurrent.atomic.AtomicBoolean
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/**
 * Lets one piece of work run at a time, answering everyone who arrives while it is running with a stand-in value
 * instead of starting a second copy.
 *
 * A deadline and a gate solve different halves of the same problem, and only the deadline is obvious. `withTimeout`
 * protects the *caller* — it stops one slow call from holding a poll open — but it cannot cancel the work it gave up
 * waiting on: a filesystem call against an unreachable mount returns when the mount does, or never. So a poller that
 * only had a deadline would start a fresh copy every cycle, and each one would park a thread that never comes back;
 * the pool is gone within minutes, and the panel that exists to report storage trouble stays dead long after the
 * mount recovers. The gate protects the *pool*: parking one thread is the price of asking at all, parking all of them
 * is not.
 *
 * The gate opens when the underlying work completes, never when a caller stops waiting for it — that distinction is
 * the whole point, and is what [[service.SingleFlightGateSpec]] pins.
 */
class SingleFlightGate {

  private val inFlight = new AtomicBoolean(false)

  /**
   * Runs `work` if nothing is already running, and otherwise answers `busy` without starting anything.
   *
   * @param busy Value to answer callers who arrive while work is in flight. By-name, so building it costs nothing on
   *             the common path.
   * @param work The work to run. Failing — or throwing before it returns a future at all — reopens the gate, since a
   *             failure is a completion: only work that is genuinely still running should keep the next caller out.
   * @return     The work's own future, so a caller can time it out without affecting the gate.
   */
  def runOrElse[T](busy: => T)(work: => Future[T]): Future[T] = {
    if (!inFlight.compareAndSet(false, true)) Future.successful(busy)
    else {
      val started =
        try work
        catch { case NonFatal(e) => Future.failed(e) }
      // parasitic: reopening the gate is a flag write, so it runs on whichever thread completed the work rather than
      // waiting for a scheduler that a saturated pool may not get to.
      started.onComplete(_ => inFlight.set(false))(ExecutionContext.parasitic)
      started
    }
  }
}
