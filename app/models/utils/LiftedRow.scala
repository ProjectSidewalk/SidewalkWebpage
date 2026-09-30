package models.utils

import slick.lifted.{CaseClassShape, FlatShapeLevel, Shape}

import scala.reflect.ClassTag

object LiftedRow {

  /**
   * Teaches Slick to use a case class of columns as a query row, so later query steps read its columns by name.
   *
   * The result class need not mirror the column class field for field: `build` receives the fetched values in the
   * column class's field order and can reshape them. Such rows are read-only, since Slick has no way back.
   *
   * @param lift  The column class's constructor, as `ColumnClass.apply.tupled`.
   * @param build Turns one fetched row of plain values into the result class.
   * @return The shape to declare as a `given` in the column class's companion.
   */
  def shape[LiftedTuple, PlainTuple, Lifted <: Product, Plain <: Product: ClassTag](lift: LiftedTuple => Lifted)(using
      Shape[FlatShapeLevel, LiftedTuple, PlainTuple, LiftedTuple]
  )(build: PlainTuple => Plain): Shape[FlatShapeLevel, Lifted, Plain, Lifted] =
    new CaseClassShape[Product, LiftedTuple, Lifted, PlainTuple, Plain](lift, build)
}
