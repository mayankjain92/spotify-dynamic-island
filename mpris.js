import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MprisInterface = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Play"/>
    <method name="Pause"/>
    <method name="Stop"/>
    <method name="SetPosition">
      <arg type="o" name="TrackId" direction="in"/>
      <arg type="x" name="Position" direction="in"/>
    </method>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Volume" type="d" access="readwrite"/>
    <property name="LoopStatus" type="s" access="readwrite"/>
    <property name="Shuffle" type="b" access="readwrite"/>
    <property name="Position" type="x" access="read"/>
    <signal name="Seeked">
      <arg type="x" name="Position"/>
    </signal>
  </interface>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <property name="Identity" type="s" access="read"/>
  </interface>
</node>`;

const MprisProxyWrapper = Gio.DBusProxy.makeProxyWrapper(MprisInterface);

export class MprisManager {
    constructor(onStateChanged, onSeeked, settings = null) {
        this._onStateChanged = onStateChanged;
        this._onSeeked = onSeeked;
        this._settings = settings;
        this._activeBusName = null;
        this._proxy = null;
        this._propChangedId = null;
        this._seekedId = null;
        this._targetSettingId = null;

        if (this._settings) {
            this._targetSettingId = this._settings.connect('changed::target-player', () => {
                this._findBestPlayer();
            });
        }

        // 1. Subscribe to NameOwnerChanged to detect players starting or quitting
        this._nameOwnerWatchId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                const [name] = params.recursiveUnpack();
                if (name && name.startsWith('org.mpris.MediaPlayer2.')) {
                    this._findBestPlayer();
                }
            }
        );

        // 2. Subscribe to PropertiesChanged on any MPRIS player
        // If an inactive player starts Playing, seamlessly switch to it
        this._globalPropWatchId = Gio.DBus.session.signal_subscribe(
            null,
            'org.freedesktop.DBus.Properties',
            'PropertiesChanged',
            '/org/mpris/MediaPlayer2',
            null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                try {
                    const [ifaceName, changedProps] = params.recursiveUnpack();
                    if (ifaceName === 'org.mpris.MediaPlayer2.Player') {
                        if (changedProps && changedProps.PlaybackStatus === 'Playing') {
                            this._findBestPlayer();
                        }
                    }
                } catch (_) {}
            }
        );

        this._findBestPlayer();
    }

    _findBestPlayer() {
        if (this._destroyed) return;

        Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'ListNames',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, res) => {
                if (this._destroyed) return;
                try {
                    const reply = conn.call_finish(res);
                    const [names] = reply.recursiveUnpack();
                    let mprisPlayers = names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));
                    const targetPlayer = this._settings ? this._settings.get_string('target-player') : 'all';
                    if (targetPlayer === 'spotify') {
                        mprisPlayers = mprisPlayers.filter(n => n === 'org.mpris.MediaPlayer2.spotify');
                    }

                    if (mprisPlayers.length === 0) {
                        if (this._activeBusName !== null) {
                            this._connectToBus(null);
                        }
                        return;
                    }

                    if (mprisPlayers.length === 1) {
                        if (this._activeBusName !== mprisPlayers[0]) {
                            this._connectToBus(mprisPlayers[0]);
                        }
                        return;
                    }

                    // Multiple players: resolve best active player
                    this._resolveBestAmong(mprisPlayers);
                } catch (e) {
                    console.warn(`[SpotifyDynamicIsland] ListNames failed: ${e.message}`);
                }
            }
        );
    }

    _resolveBestAmong(players) {
        if (this._destroyed) return;

        let resolvedCount = 0;
        const statuses = new Map();

        const evaluate = () => {
            if (this._destroyed) return;
            // 1. If Spotify is Playing -> Spotify ALWAYS wins
            if (statuses.get('org.mpris.MediaPlayer2.spotify') === 'Playing') {
                if (this._activeBusName !== 'org.mpris.MediaPlayer2.spotify') {
                    this._connectToBus('org.mpris.MediaPlayer2.spotify');
                }
                return;
            }

            // 2. Any other player currently Playing?
            const playingPlayer = players.find(p => statuses.get(p) === 'Playing');
            if (playingPlayer) {
                if (this._activeBusName !== playingPlayer) {
                    this._connectToBus(playingPlayer);
                }
                return;
            }

            // 3. Spotify present (even if Paused)? Keep Spotify as primary
            if (players.includes('org.mpris.MediaPlayer2.spotify')) {
                if (this._activeBusName !== 'org.mpris.MediaPlayer2.spotify') {
                    this._connectToBus('org.mpris.MediaPlayer2.spotify');
                }
                return;
            }

            // 4. Any other player Paused?
            const pausedPlayer = players.find(p => statuses.get(p) === 'Paused');
            if (pausedPlayer) {
                if (this._activeBusName !== pausedPlayer) {
                    this._connectToBus(pausedPlayer);
                }
                return;
            }

            // 5. Fallback to first player
            if (this._activeBusName !== players[0]) {
                this._connectToBus(players[0]);
            }
        };

        for (const bus of players) {
            Gio.DBus.session.call(
                bus,
                '/org/mpris/MediaPlayer2',
                'org.freedesktop.DBus.Properties',
                'Get',
                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'PlaybackStatus']),
                null,
                Gio.DBusCallFlags.NONE,
                600,
                null,
                (conn, res) => {
                    try {
                        const reply = conn.call_finish(res);
                        const [variant] = reply.recursiveUnpack();
                        statuses.set(bus, variant ? variant.unpack() : 'Stopped');
                    } catch (_) {
                        statuses.set(bus, 'Stopped');
                    } finally {
                        resolvedCount++;
                        if (resolvedCount === players.length) {
                            evaluate();
                        }
                    }
                }
            );
        }
    }

    _connectToBus(busName) {
        if (this._activeBusName === busName && this._proxy) {
            return;
        }

        this._cleanupProxy();
        this._activeBusName = busName;

        if (!busName) {
            if (this._onStateChanged) this._onStateChanged(null);
            return;
        }

        try {
            this._proxy = new MprisProxyWrapper(
                Gio.DBus.session,
                busName,
                '/org/mpris/MediaPlayer2'
            );

            this._propChangedId = this._proxy.connect('g-properties-changed', () => {
                if (this._onStateChanged) this._onStateChanged(this.getInfo());
            });

            this._seekedId = this._proxy.connectSignal('Seeked', (proxy, sender, [position]) => {
                if (this._onSeeked && typeof position === 'number') {
                    this._onSeeked(position);
                }
                if (this._onStateChanged) this._onStateChanged(this.getInfo());
            });

            if (this._onStateChanged) {
                this._onStateChanged(this.getInfo());
            }
        } catch (e) {
            console.warn(`[SpotifyDynamicIsland] Error connecting to ${busName}: ${e.message}`);
            this._cleanupProxy();
        }
    }

    _cleanupProxy() {
        if (this._proxy) {
            if (this._propChangedId) this._proxy.disconnect(this._propChangedId);
            if (this._seekedId) this._proxy.disconnect(this._seekedId);
            this._proxy = null;
        }
        this._propChangedId = null;
        this._seekedId = null;
    }

    _derivePlayerInfo(busName) {
        let name = 'Music';
        let icon = 'audio-x-generic-symbolic';

        try {
            if (this._proxy?.Identity) {
                name = this._proxy.Identity;
            }
        } catch (_) {}

        if (!busName) {
            return { name, icon };
        }

        const lower = busName.toLowerCase();
        if (lower.includes('spotify')) {
            name = 'Spotify';
            icon = 'spotify';
        } else if (lower.includes('firefox')) {
            name = name !== 'Music' ? name : 'Firefox';
            icon = 'firefox';
        } else if (lower.includes('chromium') || lower.includes('chrome')) {
            name = name !== 'Music' ? name : 'Chrome';
            icon = 'google-chrome';
        } else if (lower.includes('vlc')) {
            name = 'VLC';
            icon = 'vlc';
        } else if (lower.includes('amberol')) {
            name = 'Amberol';
            icon = 'io.bassi.Amberol';
        } else if (lower.includes('youtube')) {
            name = 'YouTube Music';
            icon = 'youtube-music';
        } else if (lower.includes('brave')) {
            name = 'Brave';
            icon = 'brave-browser';
        }

        return { name, icon };
    }

    getInfo() {
        if (!this._proxy) return null;

        try {
            const rawMeta = this._proxy.Metadata;
            const meta = {};
            if (rawMeta) {
                for (const k in rawMeta) {
                    const val = rawMeta[k];
                    meta[k] = (val instanceof GLib.Variant) ? val.recursiveUnpack() : val;
                }
            }

            const title = meta['xesam:title'] || 'Unknown Track';
            const artistList = meta['xesam:artist'];
            const artist = Array.isArray(artistList) ? artistList.join(', ') : (artistList || 'Unknown Artist');
            const album = meta['xesam:album'] || '';
            const artUrl = meta['mpris:artUrl'] || null;
            const trackId = meta['mpris:trackid'] || '';
            const length = meta['mpris:length'] || 0; // microseconds

            let position = 0;
            try {
                const posVariant = this._proxy.get_cached_property('Position');
                if (posVariant) position = posVariant.unpack();
            } catch (_) {}

            let status = 'Stopped';
            try {
                status = this._proxy.PlaybackStatus || 'Stopped';
            } catch (_) {}

            let volume = 1.0;
            try {
                volume = typeof this._proxy.Volume === 'number' ? this._proxy.Volume : 1.0;
            } catch (_) {}

            let shuffle = false;
            try {
                shuffle = !!this._proxy.Shuffle;
            } catch (_) {}

            let loopStatus = 'None';
            try {
                loopStatus = this._proxy.LoopStatus || 'None';
            } catch (_) {}

            const { name: playerName, icon: playerIcon } = this._derivePlayerInfo(this._activeBusName);

            return {
                busName: this._activeBusName,
                isSpotify: this._activeBusName === 'org.mpris.MediaPlayer2.spotify',
                playerName,
                playerIcon,
                status,
                title,
                artist,
                album,
                artUrl,
                trackId,
                length,
                position,
                volume,
                shuffle,
                loopStatus,
            };
        } catch (e) {
            console.warn(`[SpotifyDynamicIsland] getInfo error: ${e.message}`);
            return null;
        }
    }

    playPause() {
        try { this._proxy?.PlayPauseRemote(); } catch (_) {}
    }

    next() {
        try { this._proxy?.NextRemote(); } catch (_) {}
    }

    previous() {
        try { this._proxy?.PreviousRemote(); } catch (_) {}
    }

    seek(fraction) {
        try {
            const info = this.getInfo();
            if (info && info.length > 0 && info.trackId) {
                const targetMicro = Math.floor(fraction * info.length);
                this._proxy?.SetPositionRemote(info.trackId, targetMicro);
            }
        } catch (_) {}
    }

    seekPosition(micro) {
        try {
            const info = this.getInfo();
            if (info && info.trackId) {
                const targetMicro = Math.max(0, Math.floor(micro));
                this._proxy?.SetPositionRemote(info.trackId, targetMicro);
            }
        } catch (_) {}
    }

    setVolume(val) {
        try {
            if (!this._proxy) return;
            const target = Math.max(0.0, Math.min(1.0, val));
            this._proxy.Volume = target;
        } catch (_) {}
    }

    changeVolume(delta) {
        try {
            if (!this._proxy) return;
            const cur = typeof this._proxy.Volume === 'number' ? this._proxy.Volume : 1.0;
            const next = Math.max(0.0, Math.min(1.0, cur + delta));
            this._proxy.Volume = next;
        } catch (_) {}
    }

    toggleShuffle() {
        try {
            if (!this._proxy) return;
            this._proxy.Shuffle = !this._proxy.Shuffle;
        } catch (_) {}
    }

    toggleRepeat() {
        try {
            if (!this._proxy) return;
            const cur = this._proxy.LoopStatus;
            const next = (cur === 'None') ? 'Playlist' : (cur === 'Playlist') ? 'Track' : 'None';
            this._proxy.LoopStatus = next;
        } catch (_) {}
    }

    destroy() {
        this._destroyed = true;
        if (this._targetSettingId && this._settings) {
            this._settings.disconnect(this._targetSettingId);
            this._targetSettingId = null;
        }
        if (this._nameOwnerWatchId) {
            Gio.DBus.session.signal_unsubscribe(this._nameOwnerWatchId);
            this._nameOwnerWatchId = null;
        }
        if (this._globalPropWatchId) {
            Gio.DBus.session.signal_unsubscribe(this._globalPropWatchId);
            this._globalPropWatchId = null;
        }
        this._cleanupProxy();
        this._onStateChanged = null;
        this._onSeeked = null;
    }
}
