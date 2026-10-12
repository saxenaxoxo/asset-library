// Builds the ExtendScript that After Effects runs for "Send to After Effects". Pure, unit-tested.

export interface AfterEffectsJob {
  path: string
  /** Also add the imported item to the active composition at its current time. */
  addToComp: boolean
}

/** A JavaScript string literal that's safe to embed in a script (JSON plus the two line separators). */
export function jsString(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * ExtendScript's File() reads "%XX" in a path as an escape, so a literal "%" in a file name
 * ("50% off.mov") has to be written as "%25".
 */
export function extendScriptPath(path: string): string {
  return path.replace(/%/g, '%25')
}

/**
 * ExtendScript for one asset:
 * - .ffx presets are applied to the selected layers of the active comp
 * - .aep projects are imported as projects
 * - everything else is imported as footage (and optionally laid into the active comp)
 * The whole action is one undo step. Messages come back through `alert` only on problems.
 */
export function afterEffectsScript(job: AfterEffectsJob): string {
  return `(function () {
  var file = new File(${jsString(extendScriptPath(job.path))});
  if (!file.exists) { alert("Asset Library: the file isn't where it was last seen. Rescan the folder."); return; }
  var name = file.name.toLowerCase();
  var comp = app.project.activeItem;
  var label = file.name;
  try { label = decodeURI(file.name); } catch (ignored) {}
  app.beginUndoGroup("Asset Library: " + label);
  try {
    if (/\\.ffx$/.test(name)) {
      if (!(comp instanceof CompItem) || comp.selectedLayers.length === 0) {
        alert("Asset Library: select one or more layers in a composition, then send the preset again.");
        return;
      }
      for (var i = 0; i < comp.selectedLayers.length; i++) comp.selectedLayers[i].applyPreset(file);
      return;
    }
    var options = new ImportOptions(file);
    if (/\\.aep$/.test(name) && options.canImportAs(ImportAsType.PROJECT)) options.importAs = ImportAsType.PROJECT;
    var item = app.project.importFile(options);
    ${
      job.addToComp
        ? `if (comp instanceof CompItem && item && !(item instanceof FolderItem)) {
      var layer = comp.layers.add(item);
      layer.startTime = comp.time;
    }`
        : ''
    }
  } catch (error) {
    alert("Asset Library couldn't send this to After Effects: " + error.toString());
  } finally {
    app.endUndoGroup();
  }
})();
`
}
