/* Resize a visit selfie to a JPEG with no EXIF or location data. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.HCCheckinImage = api;
})(typeof window !== "undefined" ? window : this, function () {
  var LONG_EDGE = 1080;
  var JPEG_QUALITY = 0.82;

  function fitSize(width, height, longEdge) {
    var edge = longEdge || LONG_EDGE;
    var w = Math.round(Number(width) || 0);
    var h = Math.round(Number(height) || 0);
    if (w <= 0 || h <= 0) return { width: edge, height: edge };
    var max = Math.max(w, h);
    if (max <= edge) return { width: w, height: h };
    var scale = edge / max;
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale))
    };
  }

  function blobFromDrawable(drawable, longEdge, quality) {
    var sw = drawable.videoWidth || drawable.naturalWidth || drawable.width;
    var sh = drawable.videoHeight || drawable.naturalHeight || drawable.height;
    var size = fitSize(sw, sh, longEdge);
    var canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(drawable, 0, 0, size.width, size.height);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error("Could not save the photo"));
        else resolve(blob);
      }, "image/jpeg", quality == null ? JPEG_QUALITY : quality);
    });
  }

  return {
    LONG_EDGE: LONG_EDGE,
    JPEG_QUALITY: JPEG_QUALITY,
    fitSize: fitSize,
    blobFromDrawable: blobFromDrawable
  };
});
