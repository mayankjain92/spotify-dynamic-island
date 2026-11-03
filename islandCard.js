import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Cairo from 'gi://cairo';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { LyricsWidget } from './lyricsView.js';

function formatTime(microseconds) {
    if (!microseconds || isNaN(microseconds) || microseconds <= 0) return '0:00';
    const totalSecs = Math.floor(microseconds / 1000000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// =============================================================================
// Apple Control Center Style Volume Slider (Cairo Canvas)
// =============================================================================
export const VolumeSlider = GObject.registerClass({
    GTypeName: 'DynamicIslandVolumeSlider',
}, class VolumeSlider extends St.DrawingArea {
    _init(onChange) {
        super._init({
            style_class: 'island-volume-slider',
            reactive: true,
            can_focus: true,
            x_expand: true,
            height: 18,
        });

        this._value = 1.0;
        this._onChange = onChange;
        this._isDragging = false;
        this._barHeight = 8;

        this.connect('repaint', () => this._onRepaint());
        this.connect('button-press-event', (actor, event) => this._onButtonPress(event));
        this.connect('motion-event', (actor, event) => this._onMotion(event));
        this.connect('button-release-event', () => this._onButtonRelease());
        this.connect('scroll-event', (actor, event) => this._onScroll(event));
    }

    get value() {
        return this._value;
    }

    set value(v) {
        const clamped = Math.max(0.0, Math.min(1.0, v));
        if (Math.abs(this._value - clamped) > 0.002) {
            this._value = clamped;
            this.queue_repaint();
        }
    }

    _getFractionFromEvent(event) {
        const [x] = event.get_coords();
        const [success, localX] = this.transform_stage_point(x, 0);
        if (!success || this.width <= 0) return this._value;
        return Math.max(0.0, Math.min(1.0, localX / this.width));
    }

    _onButtonPress(event) {
        this._isDragging = true;
        this.value = this._getFractionFromEvent(event);
        if (this._onChange) this._onChange(this._value);
        return Clutter.EVENT_STOP;
    }

    _onMotion(event) {
        if (!this._isDragging) return Clutter.EVENT_PROPAGATE;
        this.value = this._getFractionFromEvent(event);
        if (this._onChange) this._onChange(this._value);
        return Clutter.EVENT_STOP;
    }

    _onButtonRelease() {
        if (this._isDragging) {
            this._isDragging = false;
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onScroll(event) {
        const dir = event.get_scroll_direction();
        let delta = 0;
        if (dir === Clutter.ScrollDirection.UP) delta = 0.05;
        else if (dir === Clutter.ScrollDirection.DOWN) delta = -0.05;

        if (delta !== 0) {
            this.value = Math.max(0.0, Math.min(1.0, this._value + delta));
            if (this._onChange) this._onChange(this._value);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onRepaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }

        const barH = this._barHeight;
        const r = barH / 2;
        const y = (h - barH) / 2;

        // 1. Trough (Translucent Track)
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.18);
        cr.arc(r, y + r, r, Math.PI * 0.5, Math.PI * 1.5);
        cr.arc(w - r, y + r, r, Math.PI * 1.5, Math.PI * 0.5);
        cr.closePath();
        cr.fill();

        // 2. Solid White Active Fill
        if (this._value > 0.01) {
            const fillW = Math.max(barH, Math.min(w, w * this._value));
            cr.setSourceRGBA(1.0, 1.0, 1.0, 0.95);
            cr.arc(r, y + r, r, Math.PI * 0.5, Math.PI * 1.5);
            cr.arc(fillW - r, y + r, r, Math.PI * 1.5, Math.PI * 0.5);
            cr.closePath();
            cr.fill();
        }

        cr.$dispose();
    }
});

// =============================================================================
// Music Progress Scrubber (Samsung OneUI Squiggly Wave or Apple Straight Line)
// =============================================================================
const WAVE_AMPLITUDE = 3.2;
const WAVE_FREQUENCY = 0.10;

export const ProgressScrubber = GObject.registerClass({
    GTypeName: 'DynamicIslandProgressScrubber',
}, class ProgressScrubber extends St.DrawingArea {
    _init(onSeek, settings) {
        super._init({
            style_class: 'island-progress-scrubber',
            reactive: true,
            can_focus: true,
            x_expand: true,
            height: 20,
        });

        this._value = 0.0;
        this._onSeek = onSeek;
        this._settings = settings;
        this._isDragging = false;
        this._isPlaying = false;
        this._phase = 0.0;
        this._accentColor = null;

        this._style = this._settings ? this._settings.get_string('progress-style') : 'wavy';

        if (this._settings) {
            this._settingId = this._settings.connect('changed::progress-style', () => {
                this._style = this._settings.get_string('progress-style');
                this.queue_repaint();
            });
        }

        this.connect('repaint', () => this._onRepaint());
        this.connect('button-press-event', (actor, event) => this._onButtonPress(event));
        this.connect('motion-event', (actor, event) => this._onMotion(event));
        this.connect('button-release-event', () => this._onButtonRelease());
    }

    get value() {
        return this._value;
    }

    set value(v) {
        const clamped = Math.max(0.0, Math.min(1.0, v));
        if (Math.abs(this._value - clamped) > 0.001) {
            this._value = clamped;
            this.queue_repaint();
        }
    }

    get isDragging() {
        return this._isDragging;
    }

    setIsPlaying(playing) {
        if (this._isPlaying !== playing) {
            this._isPlaying = playing;
            this.queue_repaint();
        }
    }

    advancePhase(speed = 0.08) {
        if (this._isPlaying && !this._isDragging && this._style === 'wavy') {
            this._phase = (this._phase + speed) % 6283.185;
            this.queue_repaint();
        }
    }

    setAccentColor(colorData) {
        this._accentColor = colorData;
        this.queue_repaint();
    }

    _getFractionFromEvent(event) {
        const [x] = event.get_coords();
        const [success, localX] = this.transform_stage_point(x, 0);
        if (!success || this.width <= 0) return this._value;
        return Math.max(0.0, Math.min(1.0, localX / this.width));
    }

    _onButtonPress(event) {
        this._isDragging = true;
        this.value = this._getFractionFromEvent(event);
        if (this._onSeek) this._onSeek(this._value);
        return Clutter.EVENT_STOP;
    }

    _onMotion(event) {
        if (!this._isDragging) return Clutter.EVENT_PROPAGATE;
        this.value = this._getFractionFromEvent(event);
        if (this._onSeek) this._onSeek(this._value);
        return Clutter.EVENT_STOP;
    }

    _onButtonRelease() {
        if (this._isDragging) {
            this._isDragging = false;
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onRepaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }

        const centerY = h / 2;
        const currentX = Math.max(0, Math.min(w, w * this._value));
        const lineThickness = 3.8;
        const knobRadius = 6.0;

        // 1. Unplayed Track (Translucent track on right)
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.22);
        cr.setLineWidth(lineThickness);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.moveTo(currentX, centerY);
        cr.lineTo(w, centerY);
        cr.stroke();

        // 2. Played Track (Samsung OneUI Squiggly Wave or Sleek Straight)
        if (this._accentColor && this._accentColor.r !== undefined) {
            const { r, g, b } = this._accentColor;
            cr.setSourceRGB(r / 255, g / 255, b / 255);
        } else {
            cr.setSourceRGBA(1.0, 1.0, 1.0, 0.95);
        }
        cr.setLineWidth(lineThickness);

        if (this._style === 'wavy' && this._isPlaying && !this._isDragging && currentX > 8) {
            // Samsung OneUI Sound-Reactive Undulating Wave
            cr.moveTo(0, centerY);
            for (let x = 0; x <= currentX; x += 1.5) {
                // Smooth damping at start and end of wave so it anchors cleanly to (0, centerY) and knob
                const dampStart = Math.min(1.0, x / 14.0);
                const dampEnd = Math.min(1.0, (currentX - x) / 14.0);
                const damping = dampStart * dampEnd;
                const y = centerY + Math.sin(x * WAVE_FREQUENCY - this._phase) * WAVE_AMPLITUDE * damping;
                cr.lineTo(x, y);
            }
            cr.stroke();
        } else {
            // Straight Line
            cr.moveTo(0, centerY);
            cr.lineTo(currentX, centerY);
            cr.stroke();
        }

        // 3. Knob / Thumb at Current Playhead
        cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
        cr.arc(currentX, centerY, knobRadius, 0, Math.PI * 2);
        cr.fill();

        cr.$dispose();
    }

    destroy() {
        if (this._settingId && this._settings) {
            this._settings.disconnect(this._settingId);
            this._settingId = null;
        }
        super.destroy();
    }
});

// =============================================================================
// Card Background Canvas (Album Cover with Vignette Fade & Rim)
// =============================================================================
export const CardBackgroundCanvas = GObject.registerClass({
    GTypeName: 'DynamicIslandCardBackgroundCanvas',
}, class CardBackgroundCanvas extends St.DrawingArea {
    _init() {
        super._init({
            reactive: false,
            can_focus: false,
            x_expand: true,
            y_expand: true,
        });

        this._bgStyle = 'cover-art';
        this._pixbuf = null;
        this._colorData = null;

        this.connect('repaint', () => this._onRepaint());
    }

    setCover(filePath, colorData, bgStyle) {
        this._colorData = colorData;
        this._bgStyle = bgStyle || 'cover-art';

        if (this._currentPath !== filePath) {
            this._currentPath = filePath;
            if (filePath && GLib.file_test(filePath, GLib.FileTest.EXISTS)) {
                try {
                    this._pixbuf = GdkPixbuf.Pixbuf.new_from_file(filePath);
                } catch (_) {
                    this._pixbuf = null;
                }
            } else {
                this._pixbuf = null;
            }
        }

        this.queue_repaint();
    }

    _onRepaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }

        const r = 28; // corner radius

        // 1. Clip to rounded capsule rectangle
        cr.arc(r, r, r, Math.PI, 1.5 * Math.PI);
        cr.arc(w - r, r, r, 1.5 * Math.PI, 2 * Math.PI);
        cr.arc(w - r, h - r, r, 0, 0.5 * Math.PI);
        cr.arc(r, h - r, r, 0.5 * Math.PI, Math.PI);
        cr.closePath();
        cr.clip();

        // 2. Solid Pitch-Black Opaque Base (100% opacity, zero background window bleed)
        cr.setSourceRGB(0, 0, 0);
        cr.paint();

        if (this._bgStyle === 'cover-art' && this._pixbuf) {
            // Draw album cover scaled & centered in the middle of the card
            const origW = this._pixbuf.get_width();
            const origH = this._pixbuf.get_height();
            const scale = Math.max(w / origW, h / origH);
            const drawW = Math.round(origW * scale);
            const drawH = Math.round(origH * scale);
            const drawX = Math.round((w - drawW) / 2);
            const drawY = Math.round((h - drawH) / 2);

            try {
                const scaledPixbuf = this._pixbuf.scale_simple(
                    drawW,
                    drawH,
                    GdkPixbuf.InterpType.BILINEAR
                );
                if (scaledPixbuf) {
                    Gdk.cairo_set_source_pixbuf(cr, scaledPixbuf, drawX, drawY);
                    cr.paint();
                }
            } catch (_) {}

            // 3. Subtle Vignette Gradient Overlay:
            // Top: fades from pitch black (0.94) to ensure title/artist text is 100% readable!
            // Middle: subtle veil (0.36) so the album cover image is rich and clearly visible!
            // Bottom: fades to pitch black (0.95) so scrubber, buttons, and volume bar are crystal clear!
            const pat = new Cairo.LinearGradient(0, 0, 0, h);
            pat.addColorStopRGBA(0.0, 0, 0, 0, 0.94);
            pat.addColorStopRGBA(0.18, 0, 0, 0, 0.72);
            pat.addColorStopRGBA(0.38, 0, 0, 0, 0.36);
            pat.addColorStopRGBA(0.58, 0, 0, 0, 0.42);
            pat.addColorStopRGBA(0.78, 0, 0, 0, 0.84);
            pat.addColorStopRGBA(1.0, 0, 0, 0, 0.96);

            cr.setSource(pat);
            cr.paint();
        } else if (this._bgStyle === 'ambient' && this._colorData && this._colorData.r !== undefined) {
            // Ambient gradient mode
            const { r: cR, g: cG, b: cB } = this._colorData;
            const pat = new Cairo.LinearGradient(0, 0, 0, h);
            pat.addColorStopRGB(0.0, (cR * 0.28) / 255, (cG * 0.28) / 255, (cB * 0.28) / 255);
            pat.addColorStopRGB(0.65, 0, 0, 0);
            pat.addColorStopRGB(1.0, 0, 0, 0);

            cr.setSource(pat);
            cr.paint();
        }

        // 4. Subtle 1px Monochrome Keyline Rim Border (Apple Dynamic Island style)
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.15);
        cr.setLineWidth(1.0);
        cr.arc(r, r, r, Math.PI, 1.5 * Math.PI);
        cr.arc(w - r, r, r, 1.5 * Math.PI, 2 * Math.PI);
        cr.arc(w - r, h - r, r, 0, 0.5 * Math.PI);
        cr.arc(r, h - r, r, 0.5 * Math.PI, Math.PI);
        cr.closePath();
        cr.stroke();

        cr.$dispose();
    }
});

// =============================================================================
// Island Card Main View
// =============================================================================
export class IslandCard {
    constructor(menu, mpris, lyricsClient, settings, onActiveLyricChanged) {
        this._menu = menu;
        this._mpris = mpris;
        this._lyricsClient = lyricsClient;
        this._settings = settings;
        this._onActiveLyricChanged = onActiveLyricChanged;

        this._lastInfo = null;
        this._lastColorData = null;
        this._currentTrackId = null;
        this._duration = 1;
        this._position = 0; // seconds (float)
        this._isPlaying = false;
        this._lastFrameTime = 0;
        this._tickId = null;

        this._currentVolume = 1.0;
        this._isLyricsOpen = false;

        this._bgStyle = this._settings ? this._settings.get_string('card-background-style') : 'cover-art';
        this._enableAmbientGlow = this._settings ? this._settings.get_boolean('enable-ambient-glow') : true;

        if (this._settings) {
            this._bgSettingId = this._settings.connect('changed::card-background-style', () => {
                this._bgStyle = this._settings.get_string('card-background-style');
                this._updateBackground();
            });

            this._ambientSettingId = this._settings.connect('changed::enable-ambient-glow', () => {
                this._enableAmbientGlow = this._settings.get_boolean('enable-ambient-glow');
                this._updateBackground();
            });
        }

        // Strip default shell background, arrow, shadows, and blur from popup container
        this._menu.actor.add_style_class_name('dynamic-island-menu');
        this._menu.box.add_style_class_name('dynamic-island-menu');
        this._menu.actor.style = 'background: transparent !important; background-color: transparent !important; box-shadow: none !important; -st-shadow: none !important; border: none !important; padding: 0 !important; margin: 0 !important;';
        this._menu.box.style = 'background: transparent !important; background-color: transparent !important; box-shadow: none !important; -st-shadow: none !important; border: none !important; padding: 0 !important; margin: 0 !important;';

        this._buildUI();

        // Smooth fluid spring expansion animation with zero flicker/double-opening
        this._menuOpenStateId = this._menu.connect('open-state-changed', (m, isOpen) => {
            if (isOpen) {
                this._updateVolumeDisplay(this._currentVolume);
                this._syncCardWidgets();

                this._cardContainer.remove_all_transitions();
                this._cardContainer.scale_x = 0.94;
                this._cardContainer.scale_y = 0.94;
                this._cardContainer.translation_y = -8;
                this._cardContainer.opacity = 0;

                this._cardContainer.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    translation_y: 0,
                    opacity: 255,
                    duration: 220,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
                this._cardContainer.remove_all_transitions();
                this._cardContainer.ease({
                    scale_x: 0.94,
                    scale_y: 0.94,
                    translation_y: -8,
                    opacity: 0,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        });
    }

    _buildUI() {
        this._menuItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._menuItem.actor.style = 'background: transparent !important; background-color: transparent !important; box-shadow: none !important; -st-shadow: none !important; border: none !important; padding: 0 !important; margin: 0 !important;';

        // BinLayout stack to hold background canvas and content together
        this._cardContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            can_focus: false,
            x_expand: true,
            y_expand: true,
        });

        // Initialize at clean 0 opacity and ready scale so opening is 100% flicker-free
        this._cardContainer.set_pivot_point(0.5, 0.0);
        this._cardContainer.opacity = 0;
        this._cardContainer.scale_x = 0.94;
        this._cardContainer.scale_y = 0.94;
        this._cardContainer.translation_y = -8;

        // Layer 1: Background canvas (Album cover with vignette fade & glowing rim)
        this._bgCanvas = new CardBackgroundCanvas();
        this._cardContainer.add_child(this._bgCanvas);

        // Layer 2: Foreground content card
        this._card = new St.BoxLayout({
            style_class: 'dynamic-island-card',
            vertical: true,
            reactive: true,
            x_expand: true,
            y_expand: true,
        });
        this._card.style = 'background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important; -st-shadow: none !important;';
        this._cardContainer.add_child(this._card);

        // 1. Track Row (Album Art + Song Title + Artist + Album)
        const trackRow = new St.BoxLayout({
            style_class: 'island-track-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._artBin = new St.Bin({
            style_class: 'island-album-art',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Clicking album art toggles lyrics mode
        this._artBin.connect('button-press-event', () => {
            this.toggleLyrics();
            return Clutter.EVENT_STOP;
        });

        this._artFallbackIcon = new St.Icon({
            icon_name: 'spotify',
            fallback_icon_name: 'audio-x-generic-symbolic',
            icon_size: 38,
            style: 'color: #1db954;',
        });
        this._artBin.set_child(this._artFallbackIcon);

        const detailsBox = new St.BoxLayout({
            style_class: 'island-track-details',
            vertical: true,
            x_expand: true,
        });

        this._titleLabel = new St.Label({
            text: 'Not Playing',
            style_class: 'island-title-label',
        });
        this._titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._artistLabel = new St.Label({
            text: 'Spotify',
            style_class: 'island-artist-label',
        });
        this._artistLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._albumLabel = new St.Label({
            text: '',
            style_class: 'island-album-label',
        });
        this._albumLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        detailsBox.add_child(this._titleLabel);
        detailsBox.add_child(this._artistLabel);
        detailsBox.add_child(this._albumLabel);

        trackRow.add_child(this._artBin);
        trackRow.add_child(detailsBox);
        this._card.add_child(trackRow);

        // 2. Live Synced Lyrics Widget (Cairo/Pango based)
        this._lyricsWidget = new LyricsWidget((seekTimeMs) => {
            this.syncPosition(seekTimeMs * 1000);
            this._mpris.seekPosition(seekTimeMs * 1000);
        });
        this._lyricsWidget.visible = false;
        this._card.add_child(this._lyricsWidget);

        // 3. Samsung OneUI Squiggly Wave / Apple Scrubber Bar
        const progressBox = new St.BoxLayout({
            style_class: 'island-progress-box',
            vertical: true,
            x_expand: true,
        });

        this._progressScrubber = new ProgressScrubber((fraction) => {
            this._position = fraction * this._duration;
            this._lastFrameTime = GLib.get_monotonic_time();
            this._mpris.seek(fraction);
            this._syncUI();
        }, this._settings);

        const timeBox = new St.BoxLayout({
            style_class: 'island-time-box',
            x_expand: true,
        });

        this._elapsedLabel = new St.Label({
            text: '0:00',
            style_class: 'island-time-label',
        });

        this._totalLabel = new St.Label({
            text: '0:00',
            style_class: 'island-time-label',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });

        timeBox.add_child(this._elapsedLabel);
        timeBox.add_child(this._totalLabel);

        progressBox.add_child(this._progressScrubber);
        progressBox.add_child(timeBox);
        this._card.add_child(progressBox);

        // 4. Media Controls Row
        const controlsBox = new St.BoxLayout({
            style_class: 'island-controls-box',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });

        // Shuffle
        this._shuffleBtn = new St.Button({
            style_class: 'island-ctrl-btn',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'media-playlist-shuffle-symbolic',
                style_class: 'island-ctrl-icon',
            }),
        });
        this._shuffleBtn.connect('clicked', () => this._mpris.toggleShuffle());

        // Previous
        const prevBtn = new St.Button({
            style_class: 'island-ctrl-btn',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'media-skip-backward-symbolic',
                style_class: 'island-ctrl-icon',
            }),
        });
        prevBtn.connect('clicked', () => {
            this._mpris.previous();
            this._position = 0;
            this._syncUI();
        });

        // Play / Pause (Solid White Circular Button)
        this._playBtn = new St.Button({
            style_class: 'island-play-btn',
            can_focus: true,
        });
        this._playIcon = new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            style_class: 'island-play-icon',
        });
        this._playBtn.set_child(this._playIcon);
        this._playBtn.connect('clicked', () => this._mpris.playPause());

        // Next
        const nextBtn = new St.Button({
            style_class: 'island-ctrl-btn',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'media-skip-forward-symbolic',
                style_class: 'island-ctrl-icon',
            }),
        });
        nextBtn.connect('clicked', () => {
            this._mpris.next();
            this._position = 0;
            this._syncUI();
        });

        // Repeat
        this._repeatBtn = new St.Button({
            style_class: 'island-ctrl-btn',
            can_focus: true,
        });
        this._repeatIcon = new St.Icon({
            icon_name: 'media-playlist-repeat-symbolic',
            style_class: 'island-ctrl-icon',
        });
        this._repeatBtn.set_child(this._repeatIcon);
        this._repeatBtn.connect('clicked', () => this._mpris.toggleRepeat());

        // Apple Music Style Lyrics Toggle Button
        this._lyricsBtn = new St.Button({
            style_class: 'island-ctrl-btn',
            can_focus: true,
            opacity: 140,
            child: new St.Icon({
                icon_name: 'format-justify-left-symbolic',
                style_class: 'island-ctrl-icon',
            }),
        });
        this._lyricsBtn.connect('clicked', () => this.toggleLyrics());

        controlsBox.add_child(this._shuffleBtn);
        controlsBox.add_child(prevBtn);
        controlsBox.add_child(this._playBtn);
        controlsBox.add_child(nextBtn);
        controlsBox.add_child(this._repeatBtn);
        controlsBox.add_child(this._lyricsBtn);
        this._card.add_child(controlsBox);

        // 5. Apple Control Center Style Volume Slider Row (Cairo)
        const volumeBox = new St.BoxLayout({
            style_class: 'island-volume-box',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._volMinIcon = new St.Icon({
            icon_name: 'audio-volume-low-symbolic',
            style_class: 'island-volume-icon',
        });

        this._volumeSlider = new VolumeSlider((volume) => {
            this._currentVolume = volume;
            this._mpris.setVolume(volume);
            this._updateVolumeIcon(volume);
        });

        const volMaxIcon = new St.Icon({
            icon_name: 'audio-volume-high-symbolic',
            style_class: 'island-volume-icon',
        });

        volumeBox.add_child(this._volMinIcon);
        volumeBox.add_child(this._volumeSlider);
        volumeBox.add_child(volMaxIcon);
        this._card.add_child(volumeBox);

        this._menuItem.actor.add_child(this._cardContainer);
        this._menu.addMenuItem(this._menuItem);
    }

    _updateBackground() {
        const filePath = this._lastColorData?.path;
        const colorData = this._lastColorData;
        const effectiveStyle = this._enableAmbientGlow ? this._bgStyle : 'black';

        this._bgCanvas.setCover(filePath, colorData, effectiveStyle);

        if (colorData && colorData.path) {
            this._artBin.style = `background-image: url('file://${colorData.path}'); border: 1px solid rgba(255, 255, 255, 0.15);`;
        }
    }

    updateAmbientSetting() {
        this._enableAmbientGlow = this._settings ? this._settings.get_boolean('enable-ambient-glow') : true;
        this._updateBackground();
    }

    toggleLyrics() {
        this._isLyricsOpen = !this._isLyricsOpen;

        if (this._isLyricsOpen) {
            this._lyricsWidget.opacity = 0;
            this._lyricsWidget.show();
            this._lyricsWidget.ease({
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            this._lyricsBtn.add_style_class_name('active');
            this._lyricsBtn.opacity = 255;

            if (this._lastInfo) {
                this._fetchLyrics(this._lastInfo);
            }
        } else {
            this._lyricsBtn.remove_style_class_name('active');
            this._lyricsBtn.opacity = 140;

            this._lyricsWidget.ease({
                opacity: 0,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._lyricsWidget.hide();
                },
            });

            if (this._onActiveLyricChanged) {
                this._onActiveLyricChanged(null);
            }
        }
    }

    isLyricsMode() {
        return this._isLyricsOpen;
    }

    async _fetchLyrics(info) {
        if (!info || !this._lyricsClient) return;

        const requestKey = `${info.title || ''}:::${info.artist || ''}`;
        this._lyricsWidget.showLoading();

        const durationSec = (info.length || 0) / 1000000;
        const lyrics = await this._lyricsClient.getLyrics(info.title, info.artist, info.album, durationSec);

        const currentKey = this._lastInfo ? `${this._lastInfo.title || ''}:::${this._lastInfo.artist || ''}` : null;
        if (requestKey !== currentKey) return;

        if (lyrics && lyrics.length > 0) {
            this._lyricsWidget.setLyrics(lyrics);
            this._lyricsWidget.updatePosition(this._position * 1000);
        } else {
            this._lyricsWidget.showEmpty('No Lyrics Found');
        }
    }

    // Direct Seek synchronization (Seeked signal from DBus)
    syncPosition(posMicro) {
        if (this._progressScrubber.isDragging) return;
        this._position = Math.max(0, posMicro / 1000000);
        this._lastFrameTime = GLib.get_monotonic_time();
        this._syncUI();
    }

    // Sync card internal widgets without emitting label updates
    _syncCardWidgets() {
        const frac = Math.max(0.0, Math.min(1.0, this._position / this._duration));
        this._progressScrubber.value = frac;
        this._elapsedLabel.text = formatTime(this._position * 1000000);
        this._lyricsWidget.updatePosition(this._position * 1000);
    }

    _syncUI() {
        this._syncCardWidgets();

        if (this._onActiveLyricChanged) {
            const activeLyric = this._lyricsWidget.getActiveText();
            this._onActiveLyricChanged(this._isLyricsOpen ? activeLyric : null);
        }
    }

    update(info, colorData) {
        this._lastInfo = info;
        this._lastColorData = colorData;

        if (!info || info.status === 'Stopped') {
            const fallbackPlayer = info?.playerName || 'Music Player';
            this._titleLabel.text = `${fallbackPlayer} Inactive`;
            this._artistLabel.text = `Start ${fallbackPlayer} to play music`;
            this._albumLabel.text = '';
            this._artBin.style = '';
            this._bgCanvas.setCover(null, null, 'black');
            this._artFallbackIcon.icon_name = info?.playerIcon || 'audio-x-generic-symbolic';
            this._artFallbackIcon.show();
            this._lyricsWidget.showEmpty(`${fallbackPlayer} Inactive`);
            this._currentTrackId = null;
            this._position = 0;
            this._isPlaying = false;
            this._progressScrubber.setIsPlaying(false);
            this._stopAnimation();
            if (this._onActiveLyricChanged) this._onActiveLyricChanged(null);
            return;
        }

        const isPlaying = info.status === 'Playing';
        this._duration = Math.max(1, (info.length || 0) / 1000000);
        this._totalLabel.text = formatTime(info.length);
        this._progressScrubber.setIsPlaying(isPlaying);

        // Track ID change detection
        const trackId = info.trackId || `${info.title}:::${info.artist}`;
        if (trackId && this._currentTrackId !== trackId) {
            this._currentTrackId = trackId;
            const newPos = (info.position || 0) / 1000000;
            this._position = newPos;
            this._lastFrameTime = GLib.get_monotonic_time();
            this._fetchLyrics(info);
        }

        // Play/Pause state transition
        if (this._isPlaying !== isPlaying) {
            this._isPlaying = isPlaying;
            if (isPlaying) {
                this._lastFrameTime = GLib.get_monotonic_time();
                this._startAnimation();
            } else {
                this._stopAnimation();
            }
        } else if (isPlaying && !this._tickId) {
            this._startAnimation();
        }

        this._titleLabel.text = info.title || 'Unknown Title';
        this._artistLabel.text = info.artist || (info.playerName || 'Unknown Artist');
        this._albumLabel.text = info.album || '';

        // Play/Pause icon toggle
        this._playIcon.icon_name = isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';

        // Shuffle active state
        if (info.shuffle) {
            this._shuffleBtn.add_style_class_name('active');
            this._shuffleBtn.opacity = 255;
        } else {
            this._shuffleBtn.remove_style_class_name('active');
            this._shuffleBtn.opacity = 140;
        }

        // Repeat active state
        if (info.loopStatus === 'Track') {
            this._repeatIcon.icon_name = 'media-playlist-repeat-song-symbolic';
            this._repeatBtn.add_style_class_name('active');
            this._repeatBtn.opacity = 255;
        } else if (info.loopStatus === 'Playlist') {
            this._repeatIcon.icon_name = 'media-playlist-repeat-symbolic';
            this._repeatBtn.add_style_class_name('active');
            this._repeatBtn.opacity = 255;
        } else {
            this._repeatIcon.icon_name = 'media-playlist-repeat-symbolic';
            this._repeatBtn.remove_style_class_name('active');
            this._repeatBtn.opacity = 140;
        }

        // Cover Art image loading & Background Canvas rendering
        if (colorData && colorData.path) {
            this._updateBackground();
            this._artFallbackIcon.hide();
        } else {
            this._artBin.style = '';
            this._bgCanvas.setCover(null, colorData, 'black');
            this._artFallbackIcon.icon_name = info.playerIcon || 'audio-x-generic-symbolic';
            this._artFallbackIcon.style = info.isSpotify ? 'color: #1db954;' : 'color: #ffffff;';
            this._artFallbackIcon.show();
        }

        // Progress bar accent color
        this._progressScrubber.setAccentColor(colorData);

        // Volume synchronization
        if (typeof info.volume === 'number') {
            this._currentVolume = info.volume;
            this._updateVolumeDisplay(this._currentVolume);
        }

        this._syncUI();
    }

    _startAnimation() {
        this._stopAnimation();
        this._lastFrameTime = GLib.get_monotonic_time();
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
            this._onTick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopAnimation() {
        if (this._tickId) {
            GLib.Source.remove(this._tickId);
            this._tickId = null;
        }
    }

    _onTick() {
        const now = GLib.get_monotonic_time();
        const dt = (now - this._lastFrameTime) / 1000000;
        this._lastFrameTime = now;

        if (this._isPlaying && !this._progressScrubber.isDragging) {
            this._position += dt;
            if (this._position > this._duration) {
                this._position = this._duration;
            }
            this._progressScrubber.advancePhase(0.08);
            this._syncUI();
        }
    }

    _updateVolumeDisplay(volume) {
        this._currentVolume = Math.max(0.0, Math.min(1.0, volume ?? 1.0));
        this._volumeSlider.value = this._currentVolume;
        this._updateVolumeIcon(this._currentVolume);
    }

    _updateVolumeIcon(volume) {
        if (this._volMinIcon) {
            this._volMinIcon.icon_name = volume <= 0.02
                ? 'audio-volume-muted-symbolic'
                : 'audio-volume-low-symbolic';
        }
    }

    destroy() {
        this._stopAnimation();
        if (this._menuOpenStateId && this._menu) {
            this._menu.disconnect(this._menuOpenStateId);
            this._menuOpenStateId = null;
        }
        if (this._bgSettingId && this._settings) {
            this._settings.disconnect(this._bgSettingId);
            this._bgSettingId = null;
        }
        if (this._ambientSettingId && this._settings) {
            this._settings.disconnect(this._ambientSettingId);
            this._ambientSettingId = null;
        }
        this._progressScrubber.destroy();
        this._lyricsWidget.destroy();
    }
}
