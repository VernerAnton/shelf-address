/*
 * Runs OpenCV.js for the cover camera off the page's main thread, so the
 * live camera view stays smooth (docs/spec-corrections.md §15).
 *
 *   → { type: "init", cvUrl }            ← { type: "ready" } | { type: "failed" }
 *   → { id, type: "detect", image }      ← { id, corners }        (corners or null)
 *   → { id, type: "flatten", image, corners } ← { id, cover }     (ImageData-shaped)
 *
 * Failures answer { id, error } so the page can fall back to a plain crop.
 */
/* global importScripts, coverVision */

var cv = null;

self.onmessage = function (event) {
  var message = event.data;
  if (message.type === "init") return init(message.cvUrl);
  if (!cv) return self.postMessage({ id: message.id, error: "not ready" });
  try {
    if (message.type === "detect") {
      self.postMessage({ id: message.id, corners: coverVision.detect(cv, message.image) });
    } else if (message.type === "flatten") {
      var cover = coverVision.flatten(cv, message.image, message.corners);
      self.postMessage({ id: message.id, cover: cover }, [cover.data.buffer]);
    }
  } catch (error) {
    self.postMessage({ id: message.id, error: String((error && error.message) || error) });
  }
};

function init(cvUrl) {
  try {
    importScripts(cvUrl, "/cover-vision.js");
  } catch (error) {
    return self.postMessage({ type: "failed", error: String(error) });
  }
  var loaded = self.cv;
  // OpenCV.js is "thenable" in a way that makes promise resolution loop
  // forever; wait for it by callback and never resolve a promise with it.
  var done = function () {
    cv = loaded;
    self.postMessage({ type: "ready" });
  };
  if (loaded.Mat) done();
  else if (typeof loaded.then === "function") loaded.then(function () { done(); });
  else loaded.onRuntimeInitialized = done;
}
