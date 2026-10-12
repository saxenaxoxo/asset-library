// Asset Library: the Premiere Pro side of the CEP panel (ExtendScript, so ES3 only).
// The panel calls AL.<function>(...) and gets JSON back: {"ok": true|false, "message": "..."}.
// Clips are imported once into an "Asset Library" bin and placed at the playhead.

var AL = (function () {
  var BIN_NAME = 'Asset Library';
  var TICKS_PER_SECOND = 254016000000;
  var TYPE_BIN = 2;

  function escapeText(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '')
      .replace(/\n/g, '\\n');
  }

  function reply(ok, message) {
    return '{"ok":' + (ok ? 'true' : 'false') + ',"message":"' + escapeText(message) + '"}';
  }

  function describe(error) {
    if (error && error.message) return error.message;
    return String(error);
  }

  function normalized(path) {
    return String(path).replace(/\\/g, '/').toLowerCase();
  }

  function findBin(root) {
    for (var i = 0; i < root.children.numItems; i++) {
      var item = root.children[i];
      if (item.type === TYPE_BIN && item.name === BIN_NAME) return item;
    }
    return null;
  }

  function getBin() {
    var root = app.project.rootItem;
    var bin = findBin(root);
    if (!bin) {
      root.createBin(BIN_NAME);
      bin = findBin(root);
    }
    if (!bin) throw new Error('Could not create the Asset Library bin.');
    return bin;
  }

  function findClip(bin, path) {
    var wanted = normalized(path);
    for (var i = 0; i < bin.children.numItems; i++) {
      var item = bin.children[i];
      if (item.type === TYPE_BIN) continue;
      var mediaPath = null;
      try {
        mediaPath = item.getMediaPath();
      } catch (ignored) {
        mediaPath = null;
      }
      if (mediaPath && (mediaPath === path || normalized(mediaPath) === wanted)) return item;
    }
    return null;
  }

  /** Imports an original once into the bin and returns its project item. */
  function importOnce(path, name) {
    var bin = getBin();
    var existing = findClip(bin, path);
    if (existing) return existing;
    var ok = app.project.importFiles([path], true, bin, false);
    if (!ok)
      throw new Error("Premiere couldn't import " + name + '. Check that the drive is connected.');
    var imported = findClip(bin, path);
    if (!imported) throw new Error('Imported ' + name + ", but couldn't find it in the bin.");
    return imported;
  }

  function activeSequence() {
    var sequence = app.project.activeSequence;
    if (!sequence) throw new Error('Open a sequence, then try again.');
    return sequence;
  }

  function clamp(index, count) {
    if (count <= 0) return 0;
    return Math.max(0, Math.min(index, count - 1));
  }

  function clipLength(item) {
    try {
      return item.getOutPoint().seconds - item.getInPoint().seconds;
    } catch (ignored) {
      return 0;
    }
  }

  /** Places one asset at the playhead. Returns how long it is, in seconds. */
  function placeOne(sequence, path, name, mode, videoTrack, audioTrack, mogrt, kind) {
    var time = sequence.getPlayerPosition();
    var video = clamp(videoTrack, sequence.videoTracks.numTracks);
    var audio = clamp(audioTrack, sequence.audioTracks.numTracks);
    if (mogrt) {
      var clip = sequence.importMGT(path, time.ticks, video, audio);
      if (!clip)
        throw new Error(
          "Premiere couldn't add " +
            name +
            ". Check that the template opens in Premiere and the target track isn't locked."
        );
      return clip.duration ? clip.duration.seconds : 0;
    }
    if (kind === 'template') throw new Error(name + " can't be placed on a timeline.");
    var item = importOnce(path, name);
    var placed =
      mode === 'insert'
        ? sequence.insertClip(item, time, video, audio)
        : sequence.overwriteClip(item, time, video, audio);
    if (!placed)
      throw new Error("Premiere didn't accept the edit. Check that the target track isn't locked.");
    return clipLength(item);
  }

  function movePlayhead(sequence, seconds) {
    if (!(seconds > 0)) return;
    var now = sequence.getPlayerPosition();
    var ticks = Math.round(Number(now.ticks) + seconds * TICKS_PER_SECOND);
    sequence.setPlayerPosition(String(ticks));
  }

  return {
    ping: function () {
      return reply(true, String(app.version));
    },

    place: function (path, name, mode, videoTrack, audioTrack, mogrt, kind) {
      try {
        placeOne(activeSequence(), path, name, mode, videoTrack, audioTrack, mogrt, kind);
        var verb = mogrt ? 'Added' : mode === 'insert' ? 'Inserted' : 'Placed';
        return reply(true, verb + ' ' + name + ' at the playhead.');
      } catch (error) {
        return reply(false, describe(error));
      }
    },

    /** Places assets one after another; each moves the playhead by its own length. */
    placeMany: function (items, mode, videoTrack, audioTrack) {
      var done = 0;
      try {
        var sequence = activeSequence();
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var seconds = placeOne(
            sequence,
            it.path,
            it.name,
            mode,
            videoTrack,
            audioTrack,
            it.mogrt,
            it.kind
          );
          done++;
          movePlayhead(sequence, seconds);
        }
        return reply(true, 'Added ' + done + ' assets at the playhead.');
      } catch (error) {
        if (done === 0) return reply(false, describe(error));
        return reply(
          false,
          'Added ' +
            done +
            ' of ' +
            items.length +
            ', then stopped at ' +
            items[done].name +
            ': ' +
            describe(error)
        );
      }
    },

    importOnly: function (path, name) {
      try {
        importOnce(path, name);
        return reply(true, 'Imported ' + name + ' into the Asset Library bin.');
      } catch (error) {
        return reply(false, describe(error));
      }
    }
  };
})();
