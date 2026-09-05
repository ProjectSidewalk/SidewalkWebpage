package service

import scala.concurrent.{ExecutionContext, Future}

/**
 * Bounded fan-out for services that run the same work over many items without starting all of it at once.
 *
 * `UserService`'s cross-city hours query is bounded by the 25-connection pool (#4526) and `TrafficService`'s GA fetch
 * by the Data API's concurrency (Planning#8) — neither owns the helper, so it lives here.
 */
object Batching {

  /**
   * Runs `work` over `items` `batchSize` at a time, each batch concurrently and the batches one after another.
   *
   * Each batch starts inside the previous batch's continuation, so the futures don't all begin when this is called.
   *
   * @param items     Items to process; order is preserved in the result.
   * @param batchSize How many to run concurrently. Must be positive.
   * @param work      What to run per item.
   * @return          One result per item, in the order given.
   */
  def inBatches[A, B](items: Seq[A], batchSize: Int)(work: A => Future[B])(implicit
      ec: ExecutionContext
  ): Future[Seq[B]] = {
    require(batchSize > 0, s"Batch size must be positive, got $batchSize")
    items.grouped(batchSize).foldLeft(Future.successful(Seq.empty[B])) { (soFar, batch) =>
      soFar.flatMap(done => Future.sequence(batch.map(work)).map(done ++ _))
    }
  }
}
