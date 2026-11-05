package util

import org.scalatestplus.play.PlaySpec

/**
 * The base class for specs: a `PlaySpec` with ScalaTest's `===` switched off, which would otherwise win over Slick's
 * and quietly turn `filter(_.id === id)` into `where false`.
 */
abstract class SidewalkSpec extends PlaySpec {
  override def convertToEqualizer[T](left: T): Equalizer[T] = super.convertToEqualizer(left)
}
