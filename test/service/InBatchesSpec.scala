package service

import org.scalatestplus.play.PlaySpec

import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.{CountDownLatch, TimeUnit}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future, Promise}

/**
 * The bound on how wide a fan-out may get (#4526).
 *
 * `getCrossCityHours` queries one schema per deployment, and the connection pool holds 25. Whether the batching
 * actually caps what is in flight is observable with a counter, so it is checked here rather than inferred from a
 * page that happens to load.
 */
class InBatchesSpec extends PlaySpec {

  implicit private val ec: ExecutionContext = ExecutionContext.global

  "inBatches" should {
    "never run more than a batch at once, which is the whole point of not fanning out to 52 connections" in {
      // Every item parks until released, so each future the fold has started is still in flight and countable. An
      // eager fan-out would put all 20 in flight; a batched one can only ever hold 4.
      val inFlight     = new AtomicInteger(0)
      val peak         = new AtomicInteger(0)
      val gates        = Seq.fill(20)(Promise[Int]())
      val firstBatchUp = new CountDownLatch(4)

      val run = UserService.inBatches(gates.indices, batchSize = 4) { i =>
        peak.updateAndGet(_ max inFlight.incrementAndGet())
        firstBatchUp.countDown()
        gates(i).future.map { v => inFlight.decrementAndGet(); v }
      }

      firstBatchUp.await(30, TimeUnit.SECONDS) mustBe true
      peak.get mustBe 4 // the rest are still unstarted, waiting on this batch rather than on a connection
      gates.zipWithIndex.foreach { case (gate, i) => gate.success(i) }
      Await.result(run, 30.seconds) mustBe gates.indices
      peak.get mustBe 4
    }

    "run the batches one after another, not all at once" in {
      // Later items resolve instantly, so only sequencing can keep them from starting while item 0 is parked.
      val started      = new AtomicInteger(0)
      val firstBatchUp = new CountDownLatch(2)
      val gate         = Promise[Int]()

      val run = UserService.inBatches(0 until 6, batchSize = 2) { i =>
        started.incrementAndGet()
        firstBatchUp.countDown()
        if (i == 0) gate.future else Future.successful(i)
      }

      firstBatchUp.await(30, TimeUnit.SECONDS) mustBe true
      started.get mustBe 2
      run.isCompleted mustBe false
      gate.success(0)
      Await.result(run, 30.seconds) mustBe (0 until 6)
      started.get mustBe 6
    }

    "return one result per item, in the order given" in {
      val out =
        UserService.inBatches(Seq("a", "b", "c", "d", "e"), batchSize = 2)(s => Future.successful(s.toUpperCase))
      Await.result(out, 30.seconds) mustBe Seq("A", "B", "C", "D", "E")
    }

    "handle an empty list and a batch larger than the work" in {
      Await.result(UserService.inBatches(Seq.empty[Int], batchSize = 6)(Future.successful), 30.seconds) mustBe empty
      Await.result(UserService.inBatches(Seq(1, 2), batchSize = 99)(Future.successful), 30.seconds) mustBe Seq(1, 2)
    }

    "refuse a batch size that would never make progress" in {
      Seq(0, -1).foreach { bad =>
        an[IllegalArgumentException] must be thrownBy UserService.inBatches(Seq(1), bad)(Future.successful)
      }
    }

    "fail the whole fan-out if an item fails, so a caller can't mistake a partial answer for a complete one" in {
      // getCrossCityHours relies on this: it recovers per city *before* handing work here, precisely so that one
      // unreadable schema costs its own row rather than the volunteer's whole total.
      val out = UserService.inBatches(0 until 4, batchSize = 2) { i =>
        if (i == 3) Future.failed(new RuntimeException("boom")) else Future.successful(i)
      }
      a[RuntimeException] must be thrownBy Await.result(out, 30.seconds)
    }
  }
}
