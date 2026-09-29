package util

import org.scalatestplus.play.PlaySpec

/**
 * The base class for every spec: a `PlaySpec` with ScalaTest's `===` switched off, so Slick's is the only one.
 *
 * ScalaTest's compares on the spot and gives back true or false, and inside a spec it wins over Slick's, so
 * `filter(_.id === id)` would quietly become `where false`. Assertions use `mustBe`, so nothing is lost.
 */
abstract class SidewalkSpec extends PlaySpec {
  override def convertToEqualizer[T](left: T): Equalizer[T] = super.convertToEqualizer(left)
}
