package service

import com.google.inject.ImplementedBy
import akka.actor.ActorSystem
import com.redis.RedisClient

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[RedisServiceImpl])
trait RedisService {
    def setRunning(): Future[Boolean]
    def isRunning(): Future[Boolean]
    def clearRunning(): Future[Long]
}

@Singleton
class RedisServiceImpl @Inject()(config: play.api.Configuration)
                                (implicit system: ActorSystem, ec: ExecutionContext) 
                                extends RedisService {

  /**
   * Reads in the values from application.conf
   */
  private val host = config.get[String]("redis.host")
  private val port = config.get[Int]   ("redis.port")
  private val client = RedisClient(host, port)

  // Flag key
  private val RunningKey = "clustering:running"

  /**
   * Sets the “clustering:running” key to “1”.
   */
  def setRunning(): Future[Boolean] = {
    client.set(RunningKey, "1")
  }

  /**
   * Returns if the “clustering:running” key exists.
   */
  def isRunning(): Future[Boolean] = {
    client.exists(RunningKey)
  }
  
  /**
   * Deletes the “clustering:running” key.
   */
  def clearRunning(): Future[Long] = {
    client.del(RunningKey)
  }
}
