package service

import org.scalatest.concurrent.ScalaFutures
import org.scalatestplus.play.PlaySpec

import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, Future, Promise}

/**
 * The gate that keeps a stuck media scan from being joined by a fresh copy on every poll (#4926).
 *
 * Its whole job is invisible when storage is healthy and decisive when it isn't: a filesystem call against a dead
 * mount never returns and cannot be cancelled, so a dashboard polling every ~20 seconds parks a thread per poll until
 * the blocking-io pool is gone — and the panel that exists to report storage trouble goes dark exactly when storage
 * is the trouble. The cases below pin the one distinction that makes that work: the gate opens when the *work*
 * finishes, never when a caller stops waiting for it.
 *
 * Pure logic — no app boot, no database, no filesystem.
 */
class SingleFlightGateSpec extends PlaySpec with ScalaFutures {

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  "SingleFlightGate" should {
    "run the work and hand back its result when nothing else is running" in {
      val gate = new SingleFlightGate
      await(gate.runOrElse("busy")(Future.successful("scanned"))) mustBe "scanned"
    }

    "answer a caller who arrives mid-flight with the stand-in, without starting a second copy" in {
      val gate    = new SingleFlightGate
      val started = new AtomicInteger(0)
      val blocker = Promise[String]()

      val first  = gate.runOrElse("busy") { started.incrementAndGet(); blocker.future }
      val second = gate.runOrElse("busy") { started.incrementAndGet(); Future.successful("second") }

      await(second) mustBe "busy"
      // The point isn't the answer the second caller got, it's that no second scan exists to park a second thread.
      started.get mustBe 1
      blocker.success("first")
      await(first) mustBe "first"
    }

    "keep the gate shut while the work runs on, even after the caller has given up waiting for it" in {
      // The deadline protects the poll; only this protects the pool. A timeout that reopened the gate would let the
      // next poll start another scan on top of a filesystem call that has not returned and may never.
      val gate    = new SingleFlightGate
      val blocker = Promise[String]()
      val first   = gate.runOrElse("busy")(blocker.future)

      // What a caller timing out looks like from here: it stops waiting, and the work keeps running.
      first.isCompleted mustBe false
      await(gate.runOrElse("busy")(Future.successful("second"))) mustBe "busy"

      blocker.success("late")
      await(first) mustBe "late"
      await(gate.runOrElse("busy")(Future.successful("third"))) mustBe "third"
    }

    "reopen once the work completes, so a recovered mount is reported instead of a permanent stand-in" in {
      val gate = new SingleFlightGate
      await(gate.runOrElse("busy")(Future.successful("first"))) mustBe "first"
      await(gate.runOrElse("busy")(Future.successful("second"))) mustBe "second"
    }

    "treat a failure as a completion, since only work still running should keep the next caller out" in {
      val gate   = new SingleFlightGate
      val failed = gate.runOrElse("busy")(Future.failed(new RuntimeException("mount gone")))
      whenReady(failed.failed)(_.getMessage mustBe "mount gone")
      await(gate.runOrElse("busy")(Future.successful("after"))) mustBe "after"
    }

    "reopen when the work throws before it returns a future at all" in {
      // A synchronous throw is the easiest way to wedge a gate shut forever: nothing ever completes to reopen it.
      val gate   = new SingleFlightGate
      val thrown = gate.runOrElse("busy")(throw new IllegalStateException("bad config"))
      whenReady(thrown.failed)(_.getMessage mustBe "bad config")
      await(gate.runOrElse("busy")(Future.successful("after"))) mustBe "after"
    }

    "never build the stand-in on the common path, since it is only meaningful when something is stuck" in {
      val gate  = new SingleFlightGate
      val built = new AtomicInteger(0)
      await(gate.runOrElse { built.incrementAndGet(); "busy" }(Future.successful("scanned"))) mustBe "scanned"
      built.get mustBe 0
    }
  }
}
