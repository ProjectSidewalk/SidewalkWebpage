package models.utils

/**
 * Encodes coordinate sequences with the Google Encoded Polyline Algorithm (precision 5), the format the Mapbox
 * Static Images API accepts as a path overlay — used for route thumbnails.
 */
object PolylineEncoder {

  /**
   * Encodes a sequence of (lng, lat) coordinates as a polyline string.
   *
   * @param coords Coordinates as (longitude, latitude) pairs, in path order.
   * @return       The encoded polyline (empty for no coordinates).
   */
  def encode(coords: Seq[(Double, Double)]): String = {
    val sb      = new StringBuilder
    var prevLat = 0L
    var prevLng = 0L
    coords.foreach { case (lng, lat) =>
      val lat5 = Math.round(lat * 1e5)
      val lng5 = Math.round(lng * 1e5)
      encodeDiff(lat5 - prevLat, sb)
      encodeDiff(lng5 - prevLng, sb)
      prevLat = lat5
      prevLng = lng5
    }
    sb.toString
  }

  /**
   * Thins a coordinate sequence to at most maxPoints, always keeping the first and last points. Thumbnails are
   * tiny, so uniform decimation looks identical to true simplification while keeping the URL short.
   */
  def decimate(coords: Seq[(Double, Double)], maxPoints: Int): Seq[(Double, Double)] = {
    if (coords.length <= maxPoints) coords
    else {
      val step = Math.ceil(coords.length.toDouble / (maxPoints - 1)).toInt
      coords.zipWithIndex.collect { case (c, i) if i % step == 0 => c } :+ coords.last
    }
  }

  /** Encodes one zigzag-encoded value in 5-bit chunks (the core of the polyline algorithm). */
  private def encodeDiff(diff: Long, sb: StringBuilder): Unit = {
    var v = diff << 1
    if (diff < 0) v = ~v
    while (v >= 0x20) {
      sb.append(((0x20 | (v & 0x1f)) + 63).toChar)
      v >>= 5
    }
    sb.append((v + 63).toChar)
  }
}
