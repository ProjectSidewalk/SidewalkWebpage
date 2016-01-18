import org.junit.runner._
import org.specs2.execute.AsResult
import org.specs2.mutable._
import org.specs2.runner._
import play.api._
import play.api.test.Helpers._
import play.api.test._

<<<<<<< HEAD
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
// import play.api.db.slick.Config.driver.simple._
=======
import org.specs2.specification.BeforeEach
import org.specs2.specification.AroundEach
import play.api.db.slick.Config.driver.simple._
>>>>>>> master
import models._

/**
 * Add your spec here.
 * You can mock out a whole application including requests, plugins etc.
 * For more information, consult the wiki.
 */
@RunWith(classOf[JUnitRunner])
class SidewalkEdgeTableSpec extends Specification {
  val fakeApplicationWithGlobal = FakeApplication(withGlobal = Some(new GlobalSettings() {
    override def onStart(app: Application) { println("Hello world!") }
  }))

  // https://www.playframework.com/documentation/2.3.x/ScalaFunctionalTestingWithSpecs2
  // https://github.com/pvoznenko/play-slick-angular-test-example

  val appWithMemoryDatabase = FakeApplication(additionalConfiguration = inMemoryDatabase("test"))

  val db = play.api.db.slick.DB

  "SidewalkEdgeTable#save" should {
    "be able to save edges" in new WithApplication() {
      db.withTransaction { transaction =>

        transaction.rollback
      }
    }

  }

  "SidewalkEdgeTable#all" should {
  }
}


@RunWith(classOf[JUnitRunner])
class AuditTaskIncompleteTableSpec extends Specification {
  import models.audit.{AuditTaskIncompleteTable, AuditTaskIncomplete}
  val fakeApplicationWithGlobal = FakeApplication(withGlobal = Some(new GlobalSettings() {
    override def onStart(app: Application) { println("Hello world!") }
  }))

  val appWithMemoryDatabase = FakeApplication(additionalConfiguration = inMemoryDatabase("test"))

//  "SidewalkEdgeTable#save" should {
//    "insert a record" in new WithApplication {
//      AuditTaskIncompleteTable.save(AuditTaskIncomplete(0, 1, "test", 0.0f, 0.0f))
//      AuditTaskIncompleteTable.list.length mustEqual 1
//    }
//  }
}