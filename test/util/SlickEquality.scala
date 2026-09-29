package util

import org.scalactic.TripleEquals

/**
 * Switches off ScalaTest's `===` so Slick's is used. ScalaTest's compares on the spot and gives back true or false,
 * so `filter(_.id === id)` would quietly become `where false`.
 */
trait SlickEquality extends TripleEquals {
  override def convertToEqualizer[T](left: T): Equalizer[T] = super.convertToEqualizer(left)
}
