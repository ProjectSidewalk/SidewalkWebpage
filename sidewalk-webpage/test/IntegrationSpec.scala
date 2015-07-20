import org.specs2.mutable._
import org.specs2.runner._
import org.junit.runner._

import play.api.test._

/**
 * add your integration spec here.
 * An integration test will fire up a whole play application in a real (or headless) browser
 */
@RunWith(classOf[JUnitRunner])
class IntegrationSpec extends Specification {

  "Application" should {

    "work from within a browser" in new WithBrowser {

      // Writing functional tests
      // https://www.playframework.com/documentation/2.3.x/ScalaFunctionalTestingWithSpecs2
      browser.goTo("/")

      browser.pageSource must contain("Project Sidewalk")
    }
  }
}
