/*
 * Cover photo vision (docs/spec-corrections.md §15): finds a book in a photo
 * and flattens it into a straight, cropped cover — what document-scanning
 * apps do. Runs inside public/cover-worker.js, off the page's main thread;
 * also loaded by the unit tests in Node. Plain JavaScript because it runs as
 * a classic worker script next to OpenCV.js, outside the Next.js build.
 *
 * Corners are given as [[x, y] × 4] in fractions of the image's width and
 * height (0–1), ordered top-left, top-right, bottom-right, bottom-left.
 */
(function (root) {
  /** Long side of the image searched for a book. Small is fast, and enough. */
  var DETECT_SIDE = 480;
  /** Long side of the finished cover. */
  var COVER_SIDE = 1600;

  /** Orders four points top-left, top-right, bottom-right, bottom-left. */
  function orderCorners(points) {
    var bySum = points.slice().sort(function (a, b) { return a[0] + a[1] - (b[0] + b[1]); });
    var tl = bySum[0];
    var br = bySum[3];
    var rest = [bySum[1], bySum[2]].sort(function (a, b) { return a[1] - a[0] - (b[1] - b[0]); });
    return [tl, rest[0], br, rest[1]];
  }

  function polygonArea(p) {
    var a = 0;
    for (var i = 0; i < p.length; i++) {
      var j = (i + 1) % p.length;
      a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
    }
    return Math.abs(a) / 2;
  }

  function isConvex(p) {
    var sign = 0;
    for (var i = 0; i < 4; i++) {
      var a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
      var cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (cross === 0) return false;
      if (sign === 0) sign = cross > 0 ? 1 : -1;
      else if ((cross > 0 ? 1 : -1) !== sign) return false;
    }
    return true;
  }

  /** Smallest interior angle, in degrees: a real cover seen at an angle stays well above 45°. */
  function minAngle(p) {
    var min = 180;
    for (var i = 0; i < 4; i++) {
      var prev = p[(i + 3) % 4], cur = p[i], next = p[(i + 1) % 4];
      var v1 = [prev[0] - cur[0], prev[1] - cur[1]];
      var v2 = [next[0] - cur[0], next[1] - cur[1]];
      var cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]));
      min = Math.min(min, (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
    }
    return min;
  }

  function matPoints(mat) {
    var out = [];
    for (var i = 0; i < mat.rows; i++) out.push([mat.data32S[i * 2], mat.data32S[i * 2 + 1]]);
    return out;
  }

  /** Reduces a contour to four corners, or null if it isn't book-shaped. */
  function quadOf(cv, contour) {
    var hull = new cv.Mat();
    var approx = new cv.Mat();
    try {
      cv.convexHull(contour, hull, false, true);
      var perimeter = cv.arcLength(hull, true);
      var steps = [0.02, 0.03, 0.045, 0.06, 0.08];
      for (var s = 0; s < steps.length; s++) {
        cv.approxPolyDP(hull, approx, steps[s] * perimeter, true);
        if (approx.rows === 4) return orderCorners(matPoints(approx));
        if (approx.rows < 4) break;
      }
      // Worn or rounded corners: the tightest rotated rectangle around it.
      var box = cv.RotatedRect.points(cv.minAreaRect(hull));
      return orderCorners(box.map(function (p) { return [p.x, p.y]; }));
    } finally {
      hull.delete();
      approx.delete();
    }
  }

  /** Every book-like outline in a black-and-white image, scored. */
  function collect(cv, binary, width, height, out) {
    var contours = new cv.MatVector();
    var hierarchy = new cv.Mat();
    try {
      cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      var frame = width * height;
      for (var i = 0; i < contours.size(); i++) {
        var contour = contours.get(i);
        var area = cv.contourArea(contour);
        // Small pieces are kept: joinPieces may put a cover back together.
        if (area < frame * 0.02) {
          contour.delete();
          continue;
        }
        var quad = quadOf(cv, contour);
        contour.delete();
        var quadArea = polygonArea(quad);
        // The whole picture isn't a book; nor is a sliver or a bow-tie.
        if (quadArea > frame * 0.97 || !isConvex(quad) || minAngle(quad) < 50) continue;
        var fill = Math.min(1, area / quadArea);
        if (fill < 0.8) continue;
        out.push({ quad: quad, area: area, score: (quadArea / frame) * fill * fill });
      }
    } finally {
      contours.delete();
      hierarchy.delete();
    }
  }

  function lineDistance(p, a, b) {
    var len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
  }

  /** Two sides lie on (nearly) the same straight line. */
  function sameLine(a1, a2, b1, b2, tolerance) {
    var angle = Math.abs(Math.atan2(a2[1] - a1[1], a2[0] - a1[0]) - Math.atan2(b2[1] - b1[1], b2[0] - b1[0]));
    angle = Math.min(angle, 2 * Math.PI - angle);
    return angle < (5 * Math.PI) / 180 && lineDistance(b1, a1, a2) < tolerance && lineDistance(b2, a1, a2) < tolerance;
  }

  function centre(q) {
    return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
  }

  /**
   * A cover crossed by a band or a line the same tone as the table is found in
   * pieces. Two pieces whose sides line up on both sides are one cover: this
   * returns the whole of it, or null if they don't fit together.
   */
  function join(a, b, frame, tolerance) {
    var A = a.quad, B = b.quad, merged = null;
    // [tl, tr, br, bl]: stacked (left and right sides in line) or side by side (top and bottom in line).
    if (sameLine(A[0], A[3], B[0], B[3], tolerance) && sameLine(A[1], A[2], B[1], B[2], tolerance)) {
      var upper = centre(A)[1] <= centre(B)[1] ? A : B;
      var lower = upper === A ? B : A;
      merged = [upper[0], upper[1], lower[2], lower[3]];
    } else if (sameLine(A[0], A[1], B[0], B[1], tolerance) && sameLine(A[3], A[2], B[3], B[2], tolerance)) {
      var left = centre(A)[0] <= centre(B)[0] ? A : B;
      var right = left === A ? B : A;
      merged = [left[0], right[1], right[2], left[3]];
    }
    if (!merged || !isConvex(merged) || minAngle(merged) < 50) return null;
    var mergedArea = polygonArea(merged);
    if (mergedArea > frame * 0.97) return null;
    // Overlapping pieces (the same one found twice) would count double.
    var fill = (a.area + b.area) / mergedArea;
    if (fill < 0.8 || fill > 1.03) return null;
    return { quad: merged, area: a.area + b.area, score: (mergedArea / frame) * fill * fill };
  }

  function sameQuad(a, b, tolerance) {
    return a.every(function (p, i) { return Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) < tolerance; });
  }

  /** Adds every whole cover that pieces in `found` make up (a few rounds, for a cover in three pieces). */
  function joinPieces(found, width, height) {
    var frame = width * height;
    var tolerance = 0.015 * Math.hypot(width, height);
    var unique = [];
    found.forEach(function (f) {
      if (!unique.some(function (u) { return sameQuad(u.quad, f.quad, tolerance); })) unique.push(f);
    });
    for (var round = 0; round < 3; round++) {
      var added = [];
      for (var i = 0; i < unique.length; i++) {
        for (var j = i + 1; j < unique.length; j++) {
          var whole = join(unique[i], unique[j], frame, tolerance);
          if (whole && !unique.concat(added).some(function (u) { return sameQuad(u.quad, whole.quad, tolerance); })) added.push(whole);
        }
      }
      if (added.length === 0) break;
      unique = unique.concat(added);
    }
    return unique;
  }

  /**
   * Finds the book in `image` (an ImageData, any size). Returns its corners as
   * fractions, or null when nothing book-shaped stands out — then the person
   * places the corners themselves.
   */
  function detect(cv, image) {
    var src = cv.matFromImageData(image);
    var gray = new cv.Mat();
    var work = new cv.Mat();
    var edges = new cv.Mat();
    var kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    try {
      var scale = Math.min(1, DETECT_SIDE / Math.max(image.width, image.height));
      var small = new cv.Mat();
      if (scale < 1) cv.resize(src, small, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
      else src.copyTo(small);
      cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      var w = gray.cols;
      var h = gray.rows;
      var found = [];

      // Light-versus-dark split of this picture (Otsu); also sets how strong
      // an edge must be to count.
      var split = cv.threshold(gray, work, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

      // 1. Edges: the cover's outline against whatever is behind it, found in
      //    each colour separately — a red band can match a brown table in
      //    brightness but not in colour. Only edges about as strong as the
      //    cover-versus-table contrast start an outline, so wood grain or a
      //    patterned cloth doesn't bury it; stripes and titles inside the
      //    cover don't matter, as only outer outlines are kept.
      var channels = new cv.MatVector();
      var channelEdges = new cv.Mat();
      try {
        cv.split(small, channels);
        var blurred = [];
        for (var k = 0; k < 3; k++) {
          var one = channels.get(k);
          cv.GaussianBlur(one, one, new cv.Size(5, 5), 0);
          blurred.push(one);
        }
        var bars = [
          [Math.max(20, split * 0.5), Math.max(40, split)],
          // A lower bar, for a cover close in tone to its background.
          [Math.max(10, split * 0.25), Math.max(30, split * 0.6)],
        ];
        for (var b = 0; b < bars.length; b++) {
          edges.create(h, w, cv.CV_8UC1);
          edges.setTo(new cv.Scalar(0));
          for (var c = 0; c < 3; c++) {
            cv.Canny(blurred[c], channelEdges, bars[b][0], bars[b][1]);
            cv.bitwise_or(edges, channelEdges, edges);
          }
          cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2);
          collect(cv, edges, w, h, found);
        }
        blurred.forEach(function (m) { m.delete(); });
      } finally {
        channels.delete();
        channelEdges.delete();
        small.delete();
      }

      // 2. Light-versus-dark regions: a pale cover on a dark table, or the
      //    reverse. Found in pieces when the cover has bands; the edges above
      //    usually find the whole of it and outscore the pieces.
      cv.morphologyEx(work, work, cv.MORPH_OPEN, kernel);
      collect(cv, work, w, h, found);
      cv.bitwise_not(work, work);
      collect(cv, work, w, h, found);

      found = joinPieces(found, w, h).filter(function (f) { return polygonArea(f.quad) >= w * h * 0.1; });
      if (found.length === 0) return null;
      found.sort(function (a, b) { return b.score - a.score; });
      return found[0].quad.map(function (p) { return [p[0] / w, p[1] / h]; });
    } finally {
      src.delete();
      gray.delete();
      work.delete();
      edges.delete();
      kernel.delete();
    }
  }

  function dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  /**
   * Flattens the part of `image` inside `corners` into an upright rectangle,
   * at most COVER_SIDE on its long side, with a mild brightness/contrast lift
   * for dim warehouse light. Returns an ImageData-shaped { width, height, data }.
   */
  function flatten(cv, image, corners) {
    var px = corners.map(function (c) { return [c[0] * image.width, c[1] * image.height]; });
    var outW = Math.max(dist(px[0], px[1]), dist(px[3], px[2]));
    var outH = Math.max(dist(px[0], px[3]), dist(px[1], px[2]));
    var scale = Math.min(1, COVER_SIDE / Math.max(outW, outH));
    outW = Math.max(1, Math.round(outW * scale));
    outH = Math.max(1, Math.round(outH * scale));

    var src = cv.matFromImageData(image);
    var from = cv.matFromArray(4, 1, cv.CV_32FC2, [].concat.apply([], px));
    var to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]);
    var matrix = cv.getPerspectiveTransform(from, to);
    var rgb = new cv.Mat();
    var flat = new cv.Mat();
    var gray = new cv.Mat();
    try {
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      cv.warpPerspective(rgb, flat, matrix, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_REPLICATE);

      // Levels: stretch the darkest and lightest 1% towards black and white,
      // gently (at most ×1.35), the same for every channel so colours hold.
      // The middle tone moves only halfway to mid-grey, so a dim photo gets
      // brighter without a pale cover turning grey.
      cv.cvtColor(flat, gray, cv.COLOR_RGB2GRAY);
      var hist = new Array(256).fill(0);
      var data = gray.data;
      for (var i = 0; i < data.length; i++) hist[data[i]]++;
      var lo = 0, hi = 255, acc = 0, cut = data.length * 0.01;
      for (lo = 0, acc = 0; lo < 255 && (acc += hist[lo]) < cut; lo++);
      for (hi = 255, acc = 0; hi > 0 && (acc += hist[hi]) < cut; hi--);
      if (hi - lo > 40 && (lo > 12 || hi < 243)) {
        var alpha = Math.min(1.35, 255 / (hi - lo));
        var mid = (lo + hi) / 2;
        flat.convertTo(flat, -1, alpha, mid * (1 - alpha) + (127.5 - mid) * 0.5);
      }

      var out = new cv.Mat();
      cv.cvtColor(flat, out, cv.COLOR_RGB2RGBA);
      var result = { width: out.cols, height: out.rows, data: new Uint8ClampedArray(out.data) };
      out.delete();
      return result;
    } finally {
      src.delete();
      from.delete();
      to.delete();
      matrix.delete();
      rgb.delete();
      flat.delete();
      gray.delete();
    }
  }

  var api = { detect: detect, flatten: flatten, orderCorners: orderCorners, DETECT_SIDE: DETECT_SIDE, COVER_SIDE: COVER_SIDE };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.coverVision = api;
})(typeof self !== "undefined" ? self : this);
