import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { IslandCard } from './islandCard.js';

export const DynamicIslandIndicator = GObject.registerClass(
class DynamicIslandIndicator extends PanelMenu.Button {
    _init(mpris, colorHelper, lyricsClient, settings) {
        super._init(0.5, 'Spotify Dynamic Island', false);

        this._mpris = mpris;
        this._colorHelper = colorHelper;
        this._lyricsClient = lyricsClient;
        this._settings = settings;
        this._eqTimer = null;
        this._lastInfo = null;
        this._lastColorData = null;
        this._activeLyric = null;

        this._showVisualizer = this._settings ? this._settings.get_boolean('show-visualizer') : true;
        this._displayMode = this._settings ? this._settings.get_string('pill-display-mode') : 'lyrics';
        this._enableAmbientGlow = this._settings ? this._settings.get_boolean('enable-ambient-glow') : true;

        // Connect GSettings changed listeners
        if (this._settings) {
            this._visSettingId = this._settings.connect('changed::show-visualizer', () => {
                this._showVisualizer = this._settings.get_boolean('show-visualizer');
                if (!this._showVisualizer) {
                    this._stopVisualizer();
                    this._eqBox.hide();
                } else {
                    this._eqBox.show();
                    if (this._lastInfo && this._lastInfo.status === 'Playing') {
                        this._startVisualizer();
                    }
                }
            });

            this._modeSettingId = this._settings.connect('changed::pill-display-mode', () => {
                this._displayMode = this._settings.get_string('pill-display-mode');
                this._updateLabel();
            });

            this._ambientSettingId = this._settings.connect('changed::enable-ambient-glow', () => {
                this._enableAmbientGlow = this._settings.get_boolean('enable-ambient-glow');
                this._applyPillArtScheme(this._lastColorData);
                if (this._islandCard) {
                    this._islandCard.updateAmbientSetting();
                }
            });
        }

        // Hide initially until active player is detected
        this.hide();

        // Build UI
        this._buildPill();

        // Dropdown Dynamic Island Card
        this._islandCard = new IslandCard(
            this.menu,
            this._mpris,
            this._lyricsClient,
            this._settings,
            (activeLyric) => this._onActiveLyricChanged(activeLyric)
        );

        // Mouse wheel scroll on the pill adjusts volume
        this.connect('scroll-event', (actor, event) => {
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP) {
                this._mpris.changeVolume(0.05);
                return Clutter.EVENT_STOP;
            } else if (dir === Clutter.ScrollDirection.DOWN) {
                this._mpris.changeVolume(-0.05);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _buildPill() {
        this._pillBox = new St.BoxLayout({
            style_class: 'dynamic-island-pill',
            reactive: false,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // 1. Cover Art / Player Icon
        this._artBin = new St.Bin({
            style_class: 'pill-art-bin',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._pillIcon = new St.Icon({
            icon_name: 'spotify',
            fallback_icon_name: 'audio-x-generic-symbolic',
            style_class: 'pill-icon',
        });
        this._artBin.set_child(this._pillIcon);
        this._pillBox.add_child(this._artBin);

        // 2. Track Title & Artist (with Pango ellipsis & typography hierarchy)
        this._label = new St.Label({
            style_class: 'pill-track-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._label.clutter_text.set_markup('<b>Spotify</b>');
        this._pillBox.add_child(this._label);

        // 3. Equalizer Visualizer Bars (3 dancing vertical bars)
        this._eqBox = new St.BoxLayout({
            style_class: 'pill-eq-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._eqBars = [
            new St.Widget({ style_class: 'pill-eq-bar', y_align: Clutter.ActorAlign.CENTER }),
            new St.Widget({ style_class: 'pill-eq-bar', y_align: Clutter.ActorAlign.CENTER }),
            new St.Widget({ style_class: 'pill-eq-bar', y_align: Clutter.ActorAlign.CENTER }),
        ];

        this._eqBars.forEach(bar => this._eqBox.add_child(bar));
        this._pillBox.add_child(this._eqBox);

        if (!this._showVisualizer) {
            this._eqBox.hide();
        }

        this.add_child(this._pillBox);
    }

    _applyPillArtScheme(colorData) {
        if (!this._enableAmbientGlow || !colorData || colorData.r === undefined) {
            this._pillBox.style = '';
            this._eqBars.forEach(b => {
                b.style = '';
            });
            if (colorData && colorData.path) {
                this._artBin.style = `background-image: url('file://${colorData.path}'); border: 1px solid rgba(255, 255, 255, 0.15);`;
            } else {
                this._artBin.style = '';
            }
            return;
        }

        const { r, g, b } = colorData;
        // 100% Solid Opaque Capsule Background:
        // Rich vibrant horizontal gradient wash fading into pitch black
        const pillTintR = Math.min(255, Math.round(r * 0.18));
        const pillTintG = Math.min(255, Math.round(g * 0.18));
        const pillTintB = Math.min(255, Math.round(b * 0.18));

        this._pillBox.style = `background-gradient-direction: horizontal; background-gradient-start: rgb(${pillTintR}, ${pillTintG}, ${pillTintB}); background-gradient-end: #000000; border: 1px solid rgba(255, 255, 255, 0.15);`;

        // Equalizer dancing bars pulse in the album art's vibrant dominant color
        this._eqBars.forEach(bar => {
            bar.style = `background-color: rgb(${r}, ${g}, ${b});`;
        });

        if (colorData.path) {
            this._artBin.style = `background-image: url('file://${colorData.path}'); border: 1px solid rgba(255, 255, 255, 0.15);`;
        }
    }

    syncPosition(positionMicro) {
        if (this._islandCard) {
            this._islandCard.syncPosition(positionMicro);
        }
    }

    _onActiveLyricChanged(activeLyric) {
        this._activeLyric = activeLyric;
        this._updateLabel();
    }

    _updateLabel() {
        if (!this._lastInfo) {
            this._label.clutter_text.set_markup('<b>Spotify</b>');
            return;
        }

        // Pill Display Mode: Live Lyrics vs Song Title
        if (this._displayMode === 'lyrics' &&
            this._islandCard.isLyricsMode() &&
            this._activeLyric &&
            this._activeLyric.trim() !== '♪' &&
            this._activeLyric.trim() !== '') {
            const safeLyric = GLib.markup_escape_text(this._activeLyric.trim(), -1);
            this._label.clutter_text.set_markup(`<b>♪</b>  <span color="#ffffff">${safeLyric}</span>`);
            return;
        }

        const title = this._lastInfo.title || 'Unknown Title';
        const artist = this._lastInfo.artist || (this._lastInfo.playerName || '');
        const safeTitle = GLib.markup_escape_text(title, -1);
        const safeArtist = GLib.markup_escape_text(artist, -1);

        if (safeArtist && safeArtist !== safeTitle) {
            this._label.clutter_text.set_markup(
                `<b>${safeTitle}</b>  <span color="#c0c0c8">${safeArtist}</span>`
            );
        } else {
            this._label.clutter_text.set_markup(`<b>${safeTitle}</b>`);
        }
    }

    async update(info) {
        this._lastInfo = info;

        // Hide compact pill when player is closed or stopped
        if (!info || info.status === 'Stopped') {
            this.hide();
            this._stopVisualizer();
            this._applyPillArtScheme(null);
            this._islandCard.update(null, null);
            return;
        }

        // Show compact pill when active
        this.show();

        const isPlaying = info.status === 'Playing';

        this._updateLabel();

        // Equalizer animation
        if (this._showVisualizer) {
            this._eqBox.show();
            if (isPlaying) {
                this._startVisualizer();
            } else {
                this._stopVisualizer();
            }
        } else {
            this._eqBox.hide();
            this._stopVisualizer();
        }

        const colorData = await this._colorHelper.getCoverAndColor(info.artUrl);
        this._lastColorData = colorData;

        if (colorData && colorData.path) {
            this._pillIcon.hide();
        } else {
            this._artBin.style = '';
            this._pillIcon.icon_name = info.playerIcon || 'audio-x-generic-symbolic';
            this._pillIcon.style = info.isSpotify ? 'color: #1db954;' : 'color: #ffffff;';
            this._pillIcon.show();
        }

        this._applyPillArtScheme(colorData);
        this._islandCard.update(info, colorData);
    }

    _startVisualizer() {
        if (this._eqTimer || !this._showVisualizer) return;

        let frame = 0;
        this._eqTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            frame++;
            const h1 = 3 + Math.round(Math.abs(Math.sin(frame * 0.7)) * 9);
            const h2 = 3 + Math.round(Math.abs(Math.sin(frame * 0.5 + 1.2)) * 10);
            const h3 = 3 + Math.round(Math.abs(Math.sin(frame * 0.8 + 2.4)) * 8);

            this._eqBars[0].set_height(h1);
            this._eqBars[1].set_height(h2);
            this._eqBars[2].set_height(h3);

            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopVisualizer() {
        if (this._eqTimer) {
            GLib.source_remove(this._eqTimer);
            this._eqTimer = null;
        }

        this._eqBars.forEach(b => b.set_height(3));
    }

    destroy() {
        this._stopVisualizer();
        if (this._visSettingId && this._settings) {
            this._settings.disconnect(this._visSettingId);
            this._visSettingId = null;
        }
        if (this._modeSettingId && this._settings) {
            this._settings.disconnect(this._modeSettingId);
            this._modeSettingId = null;
        }
        if (this._ambientSettingId && this._settings) {
            this._settings.disconnect(this._ambientSettingId);
            this._ambientSettingId = null;
        }
        this._islandCard.destroy();
        super.destroy();
    }
});
