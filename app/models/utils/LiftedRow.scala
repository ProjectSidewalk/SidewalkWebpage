package models.utils

import slick.lifted.{CaseClassShape, FlatShapeLevel, Shape}

import scala.reflect.ClassTag

object LiftedRow {

  /**
   * Lets a query use a case class of columns as its row, so later query steps can read those columns by name.
   *
   * @param lift  The column class's constructor, as `ColumnClass.apply.tupled`.
   * @param build Turns one fetched row (values in the column class's field order) into the result class.
   * @return The shape to declare as a `given` in the column class's companion.
   */
  def shape[LiftedTuple, PlainTuple, Lifted <: Product, Plain <: Product: ClassTag](lift: LiftedTuple => Lifted)(using
      Shape[FlatShapeLevel, LiftedTuple, PlainTuple, LiftedTuple]
  )(build: PlainTuple => Plain): Shape[FlatShapeLevel, Lifted, Plain, Lifted] =
    new CaseClassShape[Product, LiftedTuple, Lifted, PlainTuple, Plain](lift, build)
}
